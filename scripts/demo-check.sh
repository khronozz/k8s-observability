#!/usr/bin/env bash
# Vérifie, en LECTURE SEULE, que cette machine peut faire la démonstration : identité AWS, cluster, accès à l'API
# Kubernetes, hôte EC2, règle d'accès à Open WebUI, Open WebUI, Grafana, pods de la démonstration.
# Ne modifie rien dans AWS (il écrit seulement le fichier kubeconfig local .work/aws-kubeconfig).
# N'utilise PAS OpenTofu : ce script peut être lancé par n'importe quel membre du groupe.
# Usage : scripts/demo-check.sh      Code de sortie : 0 = tout est bon, 1 = au moins un contrôle a échoué.
# Pour corriger : scripts/demo-fix.sh
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/aws-common.sh"
set +e

FAILS=0; WARNS=0
ok()   { echo "   [OK]      $*"; }
ko()   { echo "   [ÉCHEC]   $*"; FAILS=$((FAILS+1)); }
warn() { echo "   [À VOIR]  $*"; WARNS=$((WARNS+1)); }
step() { echo; echo "== $*"; }

# ARN à utiliser dans une entrée d'accès EKS : l'utilisateur IAM tel quel, ou le rôle derrière une session de rôle.
principal_arn() {
  local arn acct role
  arn="$(aws sts get-caller-identity --query Arn --output text 2>/dev/null)" || return 1
  case "$arn" in
    *:assumed-role/*)
      acct="$(printf '%s' "$arn" | cut -d: -f5)"; role="$(printf '%s' "$arn" | cut -d/ -f2)"
      printf 'arn:aws:iam::%s:role/%s\n' "$acct" "$role" ;;
    *) printf '%s\n' "$arn" ;;
  esac
}

CLUSTER="${PREFIX}-eks"

step "1. Outils sur ce poste"
for t in aws kubectl curl; do
  if command -v "$t" >/dev/null; then ok "$t présent"; else ko "$t absent : à installer (voir docs/demo/script-video.md, phase 1)"; fi
done
[ "$FAILS" -gt 0 ] && { echo; echo "Installe les outils manquants puis relance ce script."; exit 1; }

step "2. Identité AWS (région $REGION)"
ARN="$(aws sts get-caller-identity --query Arn --output text 2>/dev/null)"
if [ -n "$ARN" ]; then ok "connecté comme ${ARN##*:}"; else
  ko "identifiants AWS absents, invalides ou expirés (aws sts get-caller-identity a échoué) : voir la phase 1, étape 2"
  echo; echo "Sans identité AWS valide, les autres contrôles ne peuvent pas tourner."; exit 1
fi

step "3. Cluster EKS $CLUSTER"
STATUS="$(aws eks describe-cluster --name "$CLUSTER" --query cluster.status --output text 2>/dev/null)"
if [ "$STATUS" = "ACTIVE" ]; then ok "cluster actif"; else
  ko "cluster introuvable ou pas actif (état : ${STATUS:-inconnu}) : demande à Nicolas si le cluster existe encore, ou si tes droits couvrent EKS"
fi

step "4. Ton adresse IP et l'API Kubernetes"
MYIP="$(curl -fsS -m 10 https://checkip.amazonaws.com 2>/dev/null | tr -d '\n')"
if [[ "$MYIP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then ok "ton adresse publique IPv4 : $MYIP"; else
  ko "adresse IPv4 publique introuvable (réseau coupé, ou IPv6 seulement) : ce projet ne gère que l'IPv4"; MYIP=""
fi
if [ -n "$MYIP" ] && [ "$STATUS" = "ACTIVE" ]; then
  if aws eks describe-cluster --name "$CLUSTER" --query 'cluster.resourcesVpcConfig.publicAccessCidrs' --output text 2>/dev/null \
      | tr '\t' '\n' | grep -qx "$MYIP/32"; then ok "$MYIP/32 est autorisée sur l'API du cluster"; else
    ko "$MYIP/32 n'est pas autorisée sur l'API du cluster : lance scripts/demo-fix.sh"
  fi
fi

step "5. Ton droit d'accès au cluster (entrée d'accès EKS)"
P="$(principal_arn)"
ENTRIES="$(aws eks list-access-entries --cluster-name "$CLUSTER" --query accessEntries --output text 2>/dev/null)"
if [ -z "$ENTRIES" ]; then warn "liste des entrées d'accès illisible (droits insuffisants ou cluster absent) : le contrôle suivant (kubectl) tranchera"
elif printf '%s\n' "$ENTRIES" | tr '\t' '\n' | grep -qx "$P"; then ok "ton identité a une entrée d'accès"; else
  ko "aucune entrée d'accès pour ton identité : lance scripts/demo-fix.sh (ou demande à Nicolas)"
fi

step "6. kubectl"
mkdir -p "$WORK"
aws eks update-kubeconfig --name "$CLUSTER" --region "$REGION" --kubeconfig "$KUBECONFIG_FILE" >/dev/null 2>&1 && chmod 600 "$KUBECONFIG_FILE"
export KUBECONFIG="$KUBECONFIG_FILE"
NODES="$(kubectl --request-timeout=15s get nodes --no-headers 2>&1)"
if [ $? -eq 0 ]; then
  READY="$(printf '%s\n' "$NODES" | awk '$2=="Ready"' | wc -l | tr -d ' ')"
  if [ "$READY" = "2" ]; then ok "2 nœuds prêts"; else warn "$READY nœud(s) prêt(s) sur 2 attendus"; fi
else
  ko "kubectl ne répond pas : $(printf '%s' "$NODES" | tail -n 1 | cut -c1-140)"
  echo "      (timeout = adresse IP non autorisée ; Unauthorized/forbidden = pas d'entrée d'accès : scripts/demo-fix.sh)"
fi

step "7. Les pods de la démonstration"
if kubectl --request-timeout=15s get nodes >/dev/null 2>&1; then
  TOTAL="$(kubectl --request-timeout=20s get pods -A --no-headers 2>/dev/null | wc -l | tr -d ' ')"
  [ "${TOTAL:-0}" -gt 30 ] && ok "$TOTAL pods dans le cluster" || warn "seulement ${TOTAL:-0} pods : la pile est-elle complète ?"
  for p in appli-demo appli-demo-long; do
    if kubectl --request-timeout=15s -n test-incident get pod "$p" >/dev/null 2>&1; then ok "pod $p présent (il doit être en erreur : c'est voulu)"; else
      warn "pod $p absent : voir la phase 2 du script pour le recréer"
    fi
  done
  if kubectl --request-timeout=15s -n grafana get secret grafana >/dev/null 2>&1; then ok "mot de passe de Grafana lisible"; else warn "secret de Grafana illisible"; fi
else
  warn "contrôle ignoré : kubectl ne répond pas"
fi

step "8. Hôte EC2 (assistant et Open WebUI)"
HOST="$(aws ec2 describe-instances --filters "Name=tag:Name,Values=${PREFIX}-host" "Name=instance-state-name,Values=running" \
  --query 'Reservations[].Instances[].[InstanceId,PublicIpAddress]' --output text 2>/dev/null | head -n 1)"
HOSTIP="$(printf '%s' "$HOST" | awk '{print $2}')"
if [ -n "$HOSTIP" ] && [ "$HOSTIP" != "None" ]; then ok "hôte en service (son adresse n'est pas affichée ici)"; else
  ko "hôte introuvable ou arrêté : demande à Nicolas (il peut le refaire avec make aws-redo-host)"; HOSTIP=""
fi
SG="$(aws ec2 describe-security-groups --filters "Name=group-name,Values=${PREFIX}-host" --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null)"
if [ -n "$MYIP" ] && [ -n "$SG" ] && [ "$SG" != "None" ]; then
  if aws ec2 describe-security-group-rules --filters "Name=group-id,Values=$SG" \
      --query 'SecurityGroupRules[?IsEgress==`false` && FromPort==`3000`].CidrIpv4' --output text 2>/dev/null \
      | tr '\t' '\n' | grep -qx "$MYIP/32"; then ok "$MYIP/32 est autorisée sur Open WebUI (port 3000)"; else
    ko "$MYIP/32 n'est pas autorisée sur Open WebUI : lance scripts/demo-fix.sh"
  fi
else
  warn "règle d'accès à Open WebUI non vérifiable (groupe de sécurité introuvable ou adresse inconnue)"
fi
if [ -n "$HOSTIP" ]; then
  CODE="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "http://$HOSTIP:3000/health" 2>/dev/null)"
  if [ "$CODE" = "200" ]; then ok "Open WebUI répond (/health : 200)"; else
    ko "Open WebUI ne répond pas (code '${CODE:-aucun}') : adresse non autorisée (demo-fix.sh) ou hôte en panne (Nicolas)"
  fi
fi

step "9. Identifiants d'Open WebUI (le contenu n'est pas affiché)"
if aws ssm get-parameter --name "/${PREFIX}/host/webui-env" --query Parameter.Name --output text >/dev/null 2>&1; then
  ok "tu peux lire le paramètre qui contient le compte d'Open WebUI (voir la phase 1, étape 6)"
else
  warn "paramètre illisible : demande le compte d'Open WebUI à Nicolas (par message privé, jamais dans Git)"
fi

echo
if [ "$FAILS" -eq 0 ]; then
  echo "RÉSULTAT : tout est bon ($WARNS point(s) à voir)."; exit 0
else
  echo "RÉSULTAT : $FAILS contrôle(s) en échec, $WARNS point(s) à voir. Lance scripts/demo-fix.sh puis relance ce script."; exit 1
fi
