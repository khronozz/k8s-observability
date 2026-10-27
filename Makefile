SHELL := /bin/bash
# TF: commande de l'outil d'infrastructure. Choix retenu : "tofu" (OpenTofu, fork libre de Terraform, mêmes fichiers .tf).
TF ?= tofu
KIND_NAME := k8s-ai-monitoring
WORK := .work
GARAGE_DIR := $(WORK)/garage
# Version de l'assistant : tag de l'image locale ET valeur passée à OpenTofu (une seule source dans ce fichier,
# à garder égale à charts/assistant/Chart.yaml).
ASSISTANT_TAG ?= 0.4.3
# Référence Git du chart Garage, figée le 18.10.2026 sur le commit utilisé lors du premier essai (chart 0.10.3, appVersion v2.4.1,
# identique à l'installation manuelle). Vide = dernier état de la branche par défaut (NON reproductible).
GARAGE_REF ?= ef6a03a4215e9a545945e6e34b43a185dd7b718a

.PHONY: help preflight check-charts local-secrets local-up local-down garage-chart local-garage local-garage-init \
        local-assistant-image local-stack local-webui-config local-all local-credentials local-test pf-grafana pf-webui \
        switch-secrets switch-image switch-apply docs check-secrets \
        aws-check aws-up aws-down aws-audit aws-allow-ip aws-redo-host

help:
	@echo "Local  : make local-all        (Kind + Garage + toute la pile, de zéro)"
	@echo "         make local-credentials  (URL et identifiants Open WebUI / Grafana)"
	@echo "         make local-down         (supprime le cluster et l'état OpenTofu local)"
	@echo "AWS    : make aws-check        (vérification préalable, ne crée pas de cluster)"
	@echo "         make aws-up           (EKS + S3 + pile d'observabilité ; ~0,48 \$$/h tant que ça tourne)"
	@echo "         make aws-down         (détruit tout, puis audit)   make aws-audit   (lecture seule)"
	@echo "         make aws-allow-ip     (autorise l'adresse IP actuelle)   make aws-redo-host (refait seulement l'hôte EC2)"
	@echo "Cloud (abandonné) : make switch-secrets, switch-image REGISTRY=..., switch-apply"
	@echo "Autres : make preflight, make check-charts, make local-test, make check-secrets, make docs"

preflight:
	scripts/preflight.sh local

# Vérifie, sur les charts publiés, les clés de valeurs supposées par le module (lues sur la branche principale
# des dépôts, pas sur la version exacte). N'installe rien.
check-charts:
	helm repo add otwld https://helm.otwld.com/ --force-update
	helm repo add open-webui https://helm.openwebui.com/ --force-update
	@echo "--- otwld/ollama 1.88.0 : clés models.pull et persistentVolume"
	helm show values otwld/ollama --version 1.88.0 | grep -n -E "^  models:|^    pull:|^persistentVolume:|^  enabled:" | head -20
	@echo "--- otwld/ollama 1.88.0 : crochet postStart rendu avec le modèle"
	helm template ollama otwld/ollama --version 1.88.0 --set 'ollama.models.pull[0]=qwen3:8b' | grep -n -B2 -A14 "postStart"
	@echo "--- open-webui 17.0.0 : clés utilisées"
	helm show values open-webui/open-webui --version 17.0.0 | grep -n -E "^ollamaUrls:|^extraEnvVars:|^enableOpenaiApi:|^websocket:" 

# --- LOCAL (Kind) ---------------------------------------------------------------------------
local-secrets:
	scripts/gen-secrets.sh envs/local

local-up:
	kind create cluster --config kind/kind-config.yaml --wait 5m
	kubectl cluster-info --context kind-$(KIND_NAME)

garage-chart:
	mkdir -p $(WORK)
	test -d $(GARAGE_DIR) || git clone https://git.deuxfleurs.fr/Deuxfleurs/garage $(GARAGE_DIR)
	if [ -n "$(GARAGE_REF)" ]; then git -C $(GARAGE_DIR) checkout "$(GARAGE_REF)"; fi
	@echo "Chart Garage : commit $$(git -C $(GARAGE_DIR) rev-parse HEAD)"
	@grep -E "^(version|appVersion):" $(GARAGE_DIR)/script/helm/garage/Chart.yaml

local-garage: garage-chart local-secrets
	cd envs/local && $(TF) init && $(TF) apply -auto-approve \
	  -var garage_chart_path=$(abspath $(GARAGE_DIR))/script/helm/garage

local-garage-init:
	scripts/garage-init.sh

# Image de l'assistant : construite sur le poste puis chargée dans les nœuds Kind (aucun registre en local).
# --no-cache : une image périmée avait déjà été déployée par erreur pendant les essais manuels.
local-assistant-image:
	docker build --no-cache -t assistant:$(ASSISTANT_TAG) assistant
	kind load docker-image assistant:$(ASSISTANT_TAG) --name $(KIND_NAME)

local-stack:
	cd envs/local && $(TF) apply -auto-approve \
	  -var garage_chart_path=$(abspath $(GARAGE_DIR))/script/helm/garage -var deploy_stack=true \
	  -var assistant_image_tag=$(ASSISTANT_TAG)

local-all: preflight local-secrets local-up local-garage local-garage-init local-assistant-image local-stack local-webui-config local-test local-credentials

# Entrée de modèle d'Open WebUI (prompt système de recopie, num_ctx) : non réalisable par variable d'environnement, cf. scripts/webui-bootstrap.sh.
local-webui-config:
	KUBE_CONTEXT=kind-$(KIND_NAME) scripts/webui-bootstrap.sh

# Contrôles de bout en bout sans interface : l'assistant répond, le modèle est présent, Open WebUI voit l'outil.
local-test:
	scripts/smoke-test.sh

local-credentials:
	@scripts/credentials.sh envs/local

# Supprime le cluster ET l'état OpenTofu local (devenu faux) et les clés S3 (Garage sera recréé).
# Les secrets d'application (secrets.auto.tfvars.json) sont conservés : identifiants stables d'une recréation à l'autre.
local-down:
	kind delete cluster --name $(KIND_NAME)
	rm -f envs/local/terraform.tfstate envs/local/terraform.tfstate.backup envs/local/s3.auto.tfvars.json

pf-grafana:
	kubectl --context kind-$(KIND_NAME) -n grafana port-forward svc/grafana 3000:80

pf-webui:
	kubectl --context kind-$(KIND_NAME) -n open-webui port-forward svc/open-webui 8080:80

# --- CLOUD (Switch) -------------------------------------------------------------------------
# Prérequis non automatisés : cluster SCK créé (scripts/sck-create-cluster.sh), buckets SCS3 créés
# (scripts/scs3-create-buckets.sh), envs/switch/terraform.tfvars rempli (endpoint, région, clés S3, registre).
switch-secrets:
	scripts/gen-secrets.sh envs/switch

# Construit pour linux/amd64 : le poste de développement est arm64 (Apple Silicon) et l'architecture des nœuds SCK
# n'a pas été vérifiée ; amd64 est une hypothèse.
switch-image:
	@test -n "$(REGISTRY)" || { echo "usage: make switch-image REGISTRY=<registre>/<projet>"; exit 1; }
	docker buildx build --platform linux/amd64 -t $(REGISTRY)/assistant:$(ASSISTANT_TAG) --push assistant

# KUBECONFIG doit pointer vers le kubeconfig SCK pour la seconde commande (même fichier que kubeconfig_path).
switch-apply: switch-secrets
	cd envs/switch && $(TF) init && $(TF) apply -var assistant_image_tag=$(ASSISTANT_TAG)
	scripts/webui-bootstrap.sh

# --- DOCUMENTATION ET HYGIÈNE DU DÉPÔT ----------------------------------------------------------
# Régénère docs/Projet5-Stack-Observabilite-Kubernetes.docx (nécessite node et npm).
docs:
	cd docs/guide-src && npm install --no-audit --no-fund && node build_docx.js

# À lancer avant chaque commit. Échoue si un fichier sensible est suivi par git ou si une valeur de secret semble écrite en clair.
# Recherche par motifs : elle ne remplace pas une relecture de `git diff --staged`.
check-secrets:
	@git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "ÉCHEC : ce dossier n'est pas un dépôt git (git init d'abord) : rien n'a été contrôlé."; exit 1; }
	@bad="$$(git ls-files | grep -E '(\.auto\.tfvars|(^|/)terraform\.tfvars$$|\.tfstate|kubeconfig|\.pem$$|\.key$$|(^|/)\.env)' || true)"; \
	if [ -n "$$bad" ]; then echo "ÉCHEC : fichiers sensibles suivis par git :"; echo "$$bad"; exit 1; fi
	@hits="$$(git grep -niIE "(password|passwd|secret_key|access_key|api[_-]?key|token)[A-Za-z_]*[\"']?[ ]*[:=][ ]*[\"'][A-Za-z0-9+/_=-]{12,}[\"']" -- . ':!*.example' ':!docs/*.docx' | grep -v 'REPLACE_' || true)"; \
	if [ -n "$$hits" ]; then echo "À vérifier : valeurs ressemblant à des secrets :"; echo "$$hits"; exit 1; fi
	@echo "check-secrets : rien de suspect (recherche par motifs, pas une preuve)."

# --- AWS (EN COURS : non exécuté à ce jour) -----------------------------------------------------
aws-check:
	scripts/aws-preflight.sh

aws-redo-host:
	scripts/aws-redo-host.sh

aws-up:
	scripts/aws-up.sh

aws-down:
	scripts/aws-down.sh

aws-audit:
	scripts/aws-audit.sh

aws-allow-ip:
	scripts/aws-allow-ip.sh
