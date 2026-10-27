#!/usr/bin/env bash
# Fonctions communes aux scripts aws-*.sh (à sourcer, pas à exécuter).
# Convention de nommage et d'étiquettes : voir envs/aws/infra/versions.tf (préfixe g13-p5, groupe 13, projet 5).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF="${TF:-tofu}"
REGION="${AWS_REGION:-us-east-1}"
PREFIX="g13-p5"
INFRA_DIR="$ROOT/envs/aws/infra"
STACK_DIR="$ROOT/envs/aws/stack"
WORK="$ROOT/.work"
KUBECONFIG_FILE="$WORK/aws-kubeconfig"
CIDR_FILE="$WORK/admin-cidrs.txt"   # adresses d'administration connues, une par ligne (ignoré par Git)

export AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION" AWS_PAGER=""

need() { command -v "$1" >/dev/null || { echo "Outil manquant : $1" >&2; exit 1; }; }

# Vérifie les identifiants AWS sans afficher le numéro de compte.
check_aws() {
  need aws
  local arn
  arn="$(aws sts get-caller-identity --query Arn --output text 2>/dev/null)" || {
    echo "Identifiants AWS absents ou invalides (aws sts get-caller-identity a échoué)." >&2; exit 1; }
  echo ">> Identité AWS : ${arn##*:} (région $REGION)"   # ${arn##*:} retire « arn:aws:iam::<compte>: »
}

# Ajoute l'adresse IPv4 publique actuelle à la liste connue et régénère admin.auto.tfvars.json.
# --reset : repart de l'adresse actuelle seule.
update_admin_cidrs() {
  need curl
  mkdir -p "$WORK"
  local ip
  ip="$(curl -fsS -m 10 https://checkip.amazonaws.com | tr -d '\n')" || { echo "Adresse IP publique introuvable." >&2; exit 1; }
  [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || { echo "Adresse non IPv4 : '$ip' (IPv6 non géré)." >&2; exit 1; }
  if [ "${1:-}" = "--reset" ]; then : > "$CIDR_FILE"; fi
  touch "$CIDR_FILE"
  grep -qx "$ip/32" "$CIDR_FILE" || echo "$ip/32" >> "$CIDR_FILE"
  python3 - "$CIDR_FILE" "$INFRA_DIR/admin.auto.tfvars.json" <<'PY'
import json, sys
cidrs = [l.strip() for l in open(sys.argv[1]) if l.strip()]
json.dump({"admin_cidrs": cidrs}, open(sys.argv[2], "w"))
PY
  echo ">> Adresses d'administration autorisées : $(paste -sd' ' "$CIDR_FILE")"
}

# Variable obligatoire registry_token : lue dans .work/registry-token si le fichier existe. À la destruction, sa valeur
# n'a aucun effet mais OpenTofu exige qu'elle soit définie : à défaut de fichier on met un texte sans valeur.
load_registry_token_for_destroy() {
  if [ -s "$WORK/registry-token" ]; then
    TF_VAR_registry_token="$(tr -d '\n\r ' < "$WORK/registry-token")"
  else
    TF_VAR_registry_token=inutile
  fi
  export TF_VAR_registry_token
}

# Masque ce qui ne doit pas rester dans un terminal, un journal ou une capture : clés d'accès, secrets et numéro de compte.
# À placer après chaque appel tofu apply / destroy. Avec pipefail, l'échec de tofu reste visible.
mask_output() {
  perl -pe 'BEGIN{$|=1}
    s/((?:access_?key_?id|secret_?access_?key)\s*=\s*)"[^"]*"/$1"<masqué>"/ig;
    s/AKIA[0-9A-Z]{16}/<CLÉ>/g;
    s/(?<![0-9A-Za-z])\d{12}(?![0-9A-Za-z])/<COMPTE>/g'
}

# Jeton du registre (obligatoire pour créer ou modifier l'hôte : sa valeur est écrite dans SSM). Vérifie le fichier AVANT
# toute action, puis exporte TF_VAR_registry_token. Ne jamais l'afficher.
TOKEN_FILE="$WORK/registry-token"
# Droits d'un fichier en octal, sur Linux (GNU stat) comme sur macOS (BSD stat). Attention : « stat -f » existe aussi sous
# Linux avec un autre sens (état du système de fichiers) et réussit sans donner les droits : on essaie donc GNU en premier.
file_mode() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }
require_registry_token() {
  [ -s "$TOKEN_FILE" ] || { echo "Jeton du registre absent : écrire le jeton de déploiement GitLab (read_registry) dans $TOKEN_FILE (une ligne, chmod 600)." >&2; exit 1; }
  [ "$(file_mode "$TOKEN_FILE")" = "600" ] || { echo "Droits de $TOKEN_FILE : attendu 600 (chmod 600 $TOKEN_FILE)." >&2; exit 1; }
  TF_VAR_registry_token="$(tr -d '\n\r ' < "$TOKEN_FILE")"
  export TF_VAR_registry_token
}

# Rend l'API Kubernetes joignable depuis l'adresse IP actuelle SANS passer par OpenTofu (qui, lancé en entier, aurait aussi
# changé d'autres choses), puis écrit le kubeconfig. Retourne 1 si le cluster n'existe pas ou reste injoignable.
# Constaté le 26.10.2026 : sans cela, kubectl se bloque ("TLS handshake timeout") dès que l'adresse IP a changé.
ensure_api_access() {
  local cluster="${PREFIX}-eks" ip cidrs new uid st i
  aws eks describe-cluster --name "$cluster" --region "$REGION" >/dev/null 2>&1 || { echo "   cluster $cluster absent."; return 1; }
  ip="$(curl -fsS -m 10 https://checkip.amazonaws.com | tr -d '\n')" || { echo "   adresse IP publique introuvable." >&2; return 1; }
  cidrs="$(aws eks describe-cluster --name "$cluster" --region "$REGION" --query 'cluster.resourcesVpcConfig.publicAccessCidrs' --output text | tr '\t' '\n')"
  if ! printf '%s\n' "$cidrs" | grep -qx "$ip/32"; then
    echo ">> $ip/32 n'est pas autorisée sur l'API du cluster : ajout (quelques minutes)"
    new="$(printf '%s\n%s/32\n' "$cidrs" "$ip" | sort -u | paste -sd, -)"
    uid="$(aws eks update-cluster-config --name "$cluster" --region "$REGION" \
      --resources-vpc-config "publicAccessCidrs=$new" --query update.id --output text)" || return 1
    for i in $(seq 1 90); do
      st="$(aws eks describe-update --name "$cluster" --region "$REGION" --update-id "$uid" --query update.status --output text 2>/dev/null || echo ?)"
      case "$st" in Successful) break ;; Failed|Cancelled) echo "   mise à jour de l'accès : $st" >&2; return 1 ;; esac
      sleep 10
    done
  fi
  mkdir -p "$WORK"
  aws eks update-kubeconfig --name "$cluster" --region "$REGION" --kubeconfig "$KUBECONFIG_FILE" >/dev/null
  chmod 600 "$KUBECONFIG_FILE"
  for i in $(seq 1 24); do
    KUBECONFIG="$KUBECONFIG_FILE" kubectl --request-timeout=10s get nodes >/dev/null 2>&1 && return 0
    sleep 5
  done
  echo "   l'API ne répond toujours pas depuis $ip." >&2
  return 1
}

# Attend que tous les pods des espaces de noms donnés soient prêts (Running prêt, ou Completed). Le délai est large (40 min
# par défaut) et ne détruit rien s'il est dépassé : on affiche ce qui n'est pas prêt et on s'arrête, la relance reprend.
wait_pods_ready() { # wait_pods_ready délai_en_secondes ns...
  local limit="$1" ns total bad t0 all_ok lines notready=""; shift
  t0=$(date +%s)
  while :; do
    all_ok=1; notready=""
    for ns in "$@"; do
      lines="$(kubectl --request-timeout=20s get pods -n "$ns" --no-headers 2>/dev/null || true)"
      total="$(printf '%s\n' "$lines" | grep -c . || true)"
      bad="$(printf '%s\n' "$lines" | awk 'NF{split($2,a,"/"); if(!($3=="Completed" || ($3=="Running" && a[1]==a[2] && a[1]>0))) print $1" ("$3", "$2")"}')"
      if [ "$total" -eq 0 ] || [ -n "$bad" ]; then all_ok=0; notready="$notready
   $ns : $([ "$total" -eq 0 ] && echo "aucun pod encore" || echo "$bad" | paste -sd';' -)"; fi
    done
    [ "$all_ok" = 1 ] && return 0
    if [ $(( $(date +%s) - t0 )) -ge "$limit" ]; then
      echo "Délai dépassé ($((limit/60)) min). Pods pas prêts :$notready" >&2
      return 1
    fi
    echo "   en attente ($(( ($(date +%s) - t0) / 60 )) min) :$(printf '%s' "$notready" | head -n 4 | cut -c1-160)"
    sleep 30
  done
}

# Attend qu'Open WebUI réponde. S'arrête tout de suite si l'hôte annonce un échec (repère G13-ECHEC dans sa sortie console).
wait_webui() { # wait_webui url instance_id délai_en_secondes
  local url="$1" id="$2" limit="$3" t0 out n=0
  t0=$(date +%s)
  while :; do
    if curl -fsS -m 5 -o /dev/null "$url/health" 2>/dev/null; then return 0; fi
    n=$((n+1))
    if [ $((n % 4)) -eq 0 ]; then
      out="$(aws ec2 get-console-output --instance-id "$id" --region "$REGION" --latest --output text 2>/dev/null || true)"
      if printf '%s' "$out" | grep -q 'G13-ECHEC'; then
        echo "L'hôte signale un échec de son démarrage :" >&2
        printf '%s' "$out" | tail -n 25 | mask_output >&2
        return 2
      fi
    fi
    if [ $(( $(date +%s) - t0 )) -ge "$limit" ]; then
      echo "Open WebUI ne répond pas après $((limit/60)) min. Fin de la sortie console de l'hôte :" >&2
      aws ec2 get-console-output --instance-id "$id" --region "$REGION" --latest --output text 2>&1 | tail -n 25 | mask_output >&2 || true
      return 1
    fi
    echo "   Open WebUI ne répond pas encore ($(( ($(date +%s) - t0) / 60 )) min)"
    sleep 10
  done
}
