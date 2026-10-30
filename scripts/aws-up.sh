#!/usr/bin/env bash
# Déploie sur AWS : infrastructure (VPC, EKS, S3, IAM, hôte EC2) puis pile d'observabilité (Mimir, Loki, Alloy, Grafana).
# Usage : scripts/aws-up.sh [--reset] [--sans-preflight]
#   --reset            ne garder que l'adresse IP actuelle dans les adresses autorisées (sinon on ajoute la nouvelle)
#   --sans-preflight   saute la vérification préalable (déconseillé : elle évite d'attendre 10 min avant un échec évitable)
# COÛT : environ 0,48 $ par heure tant que le cluster existe (plan de contrôle + 2 × m5.xlarge, prix relevés le
# 22.10.2026 ; hors volumes EBS, hôte EC2 et trafic). Détruire avec scripts/aws-down.sh dès la fin des tests.
# Prérequis : envs/aws/infra/terraform.tfvars avec `kubernetes_version`, `assistant_image` et `registry_username`
# (voir terraform.tfvars.example), et le jeton de déploiement GitLab (read_registry) dans .work/registry-token
# (une ligne, droits 600, ignoré par Git). L'image de l'assistant doit déjà être poussée (linux/amd64).
# Le script peut être RELANCÉ après un échec : il reprend où il s'est arrêté, sans tout détruire. Aucun délai dépassé ne
# détruit ni ne casse quoi que ce soit (voir la variable helm_wait du module). N'affiche aucun secret.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/aws-common.sh"

RESET=""; PREFLIGHT=1
for a in "$@"; do case "$a" in --reset) RESET="--reset" ;; --sans-preflight) PREFLIGHT=0 ;; *) echo "Option inconnue : $a" >&2; exit 2 ;; esac; done

T_START=$(date +%s)
step() { local now; now=$(date +%s); echo ">> $1 [écoulé : $(( (now - T_START) / 60 )) min $(( (now - T_START) % 60 )) s]"; }

need "$TF"; need kubectl; need python3
check_aws
[ -f "$INFRA_DIR/terraform.tfvars" ] || { echo "Créer envs/aws/infra/terraform.tfvars (voir terraform.tfvars.example)." >&2; exit 1; }
require_registry_token
update_admin_cidrs "$RESET"

if [ "$PREFLIGHT" = 1 ]; then
  step "0/5 Vérification préalable (aucun cluster n'est créé)"
  "$ROOT/scripts/aws-preflight.sh" || { echo "Vérification préalable en échec : rien n'a été créé. Régler les [ÉCHEC], puis relancer." >&2; exit 1; }
fi

step "1/5 Infrastructure (VPC, EKS, S3, IAM, hôte EC2) : le cluster met environ 10 minutes à apparaître"
"$TF" -chdir="$INFRA_DIR" init -input=false >/dev/null
"$TF" -chdir="$INFRA_DIR" apply -input=false -auto-approve 2>&1 | mask_output

step "2/5 Kubeconfig et attente des nœuds"
CLUSTER="$("$TF" -chdir="$INFRA_DIR" output -raw cluster_name)"
aws eks update-kubeconfig --name "$CLUSTER" --region "$REGION" --kubeconfig "$KUBECONFIG_FILE" >/dev/null
chmod 600 "$KUBECONFIG_FILE"
export KUBECONFIG="$KUBECONFIG_FILE"
ready=0
for i in $(seq 1 60); do
  ready="$(kubectl --request-timeout=10s get nodes --no-headers 2>/dev/null | grep -c ' Ready' || true)"
  [ "$ready" -ge 2 ] && break
  echo "   nœuds prêts : $ready/2 (essai $i/60)"; sleep 15
done
[ "${ready:-0}" -ge 2 ] || { echo "Les nœuds ne sont pas prêts après 15 min. Voir 'kubectl get nodes' (KUBECONFIG=$KUBECONFIG_FILE). Rien n'est détruit : relancer aws-up.sh quand c'est réglé." >&2; exit 1; }
kubectl --request-timeout=20s get nodes

echo ">> Classe de stockage par défaut (gp3, pilote EBS CSI)"
kubectl apply -f "$STACK_DIR/storageclass.yaml"

step "3/5 Secrets de la pile (fichier ignoré par Git)"
SECRETS="$STACK_DIR/secrets.auto.tfvars.json"
if [ ! -f "$SECRETS" ]; then
  need openssl
  umask 077
  printf '{\n  "grafana_admin_password": "%s"\n}\n' "$(openssl rand -base64 24 | tr -d '/+=\n' | cut -c1-24)" > "$SECRETS"
fi

step "4/5 Pile d'observabilité (Mimir, Loki, Alloy, Grafana) : installation, puis attente de l'état réel des pods (jusqu'à 40 min)"
"$TF" -chdir="$STACK_DIR" init -input=false >/dev/null
"$TF" -chdir="$STACK_DIR" apply -input=false -auto-approve -var "kubeconfig_path=$KUBECONFIG_FILE" 2>&1 | mask_output
if ! wait_pods_ready 2400 mimir loki monitoring grafana; then
  echo "Les pods ne sont pas tous prêts. Rien n'est cassé : 'kubectl get pods -A' montre où ça bloque, et une relance de aws-up.sh reprend ici." >&2
  exit 1
fi
echo "   tous les pods de Mimir, Loki, Alloy et Grafana sont prêts"

step "5/5 Attente d'Open WebUI sur l'hôte (installation de Docker, téléchargement des images : jusqu'à 25 min)"
WEBUI_URL="$("$TF" -chdir="$INFRA_DIR" output -raw webui_url)"
HOST_ID="$("$TF" -chdir="$INFRA_DIR" output -raw host_instance_id)"
if wait_webui "$WEBUI_URL" "$HOST_ID" 1500; then
  echo ">> Open WebUI répond : $WEBUI_URL"
  echo ">> Compte : $("$TF" -chdir="$INFRA_DIR" output -raw webui_admin_email) ; mot de passe : $TF -chdir=envs/aws/infra output -raw webui_admin_password"
else
  echo ">> L'hôte n'est pas opérationnel. Le cluster, lui, est en place. Pour refaire SEULEMENT l'hôte (environ 5 à 15 min) :" >&2
  echo ">>   scripts/aws-redo-host.sh" >&2
  exit 1
fi

step "Terminé"
echo ">> Pour kubectl : export KUBECONFIG=$KUBECONFIG_FILE"
echo ">> RAPPEL : le cluster est facturé à l'heure. Détruire avec : make aws-down"
