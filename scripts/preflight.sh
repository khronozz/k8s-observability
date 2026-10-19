#!/usr/bin/env bash
# Pré-contrôle : outils présents, démon Docker actif, mémoire suffisante. Ne modifie rien.
# Usage : scripts/preflight.sh [local|switch]
set -uo pipefail

MODE="${1:-local}"
TF="${TF:-tofu}"
fail=0

check() { # nom commande-de-version
  local name="$1"; shift
  if command -v "$name" >/dev/null 2>&1; then
    printf '  OK   %-10s %s\n' "$name" "$("$@" 2>&1 | head -n1)"
  else
    printf '  MANQUE %-8s\n' "$name"; fail=1
  fi
}

echo ">> Outils"
check "$TF" "$TF" version
check helm helm version --short
check kubectl kubectl version --client
check git git --version
check openssl openssl version
check python3 python3 --version
if [ "$MODE" = "local" ]; then
  check kind kind version
  check docker docker --version
else
  # Sur le cloud, docker ne sert qu'à construire et pousser l'image de l'assistant.
  check docker docker --version
fi

if [ "$MODE" = "local" ]; then
  echo ">> Docker"
  if docker info >/dev/null 2>&1; then
    mem_b="$(docker info --format '{{.MemTotal}}' 2>/dev/null || echo 0)"
    cpus="$(docker info --format '{{.NCPU}}' 2>/dev/null || echo 0)"
    echo "  démon actif ; CPU=$cpus ; mémoire=$(( mem_b / 1024 / 1024 / 1024 )) Gio"
    # Seuil : la pile mesurée sur Kind (VM Docker de 15,6 Gio) occupait ~8 Gio hors modèle + ~6,7 Gio pour qwen3:8b.
    if [ "$mem_b" -lt $(( 14 * 1024 * 1024 * 1024 )) ]; then
      echo "  ATTENTION : moins de 14 Gio pour Docker ; qwen3:8b (6,7 Go avec un contexte de 8192) risque de ne pas tenir."
    fi
  else
    echo "  Le démon Docker ne répond pas."; fail=1
  fi
  echo ">> Clusters Kind existants"
  kind get clusters 2>&1 | sed 's/^/  /'
fi

if [ "$fail" -ne 0 ]; then
  echo "Pré-contrôle ÉCHOUÉ." >&2
  exit 1
fi
echo "Pré-contrôle réussi."
