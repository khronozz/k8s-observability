const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType,
  ShadingType, AlignmentType, LevelFormat, BorderStyle, Footer, PageNumber, TableOfContents,
} = require('docx');

const W = 9638; // largeur utile A4 (marges 2 cm)

// ---------- helpers ----------
function runs(text, base = {}) {
  // **gras**, `code`
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), ...base }));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(new TextRun({ text: tok.slice(2, -2), bold: true, ...base }));
    else out.push(new TextRun({ text: tok.slice(1, -1), font: 'Courier New', size: 19, ...base }));
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), ...base }));
  return out;
}
const P = (t, opts = {}) => new Paragraph({ children: runs(t), spacing: { after: 120 }, ...opts });
const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)], pageBreakBefore: false });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const H3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(t)] });
const B = (t, level = 0) => new Paragraph({ numbering: { reference: 'bul', level }, children: runs(t), spacing: { after: 60 } });
const NN = (ref) => (t) => new Paragraph({ numbering: { reference: ref, level: 0 }, children: runs(t), spacing: { after: 60 } });
const N2 = NN('num2');
const N3 = NN('num3');
const N = (t) => new Paragraph({ numbering: { reference: 'num', level: 0 }, children: runs(t), spacing: { after: 60 } });

function code(text) {
  return text.split('\n').map((l, i, a) => new Paragraph({
    children: [new TextRun({ text: l === '' ? ' ' : l, font: 'Courier New', size: 18 })],
    shading: { type: ShadingType.CLEAR, fill: 'F2F2F2', color: 'auto' },
    spacing: { after: i === a.length - 1 ? 160 : 0, line: 240 },
    indent: { left: 120, right: 120 },
  }));
}

const TAGS = {
  doc: ['VÉRIFIÉ DANS LA DOC', 'E2F0D9'],
  notest: ['NON TESTÉ', 'FFF2CC'],
  val: ['À VALIDER', 'FCE4D6'],
  obs: ['OBSERVÉ SUR KIND', 'DDEBF7'],
  code: ['VÉRIFIÉ DANS LE CODE', 'E2F0D9'],
  aws: ['OBSERVÉ AVEC LE CLI AWS', 'DDEBF7'],
  eks: ['OBSERVÉ SUR AWS', 'DDEBF7'],
};
function note(kind, text) {
  const [label, fill] = TAGS[kind];
  return new Paragraph({
    children: [new TextRun({ text: label + ' : ', bold: true }), ...runs(text)],
    shading: { type: ShadingType.CLEAR, fill, color: 'auto' },
    spacing: { before: 60, after: 140 },
    indent: { left: 120, right: 120 },
  });
}

const border = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
const borders = { top: border, bottom: border, left: border, right: border };
function table(headers, rows, widths) {
  const total = widths.reduce((a, b) => a + b, 0);
  const cell = (t, w, head) => new TableCell({
    width: { size: w, type: WidthType.DXA },
    borders,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    shading: head ? { type: ShadingType.CLEAR, fill: 'D9E2F3', color: 'auto' } : undefined,
    children: [new Paragraph({ children: runs(t, head ? { bold: true, size: 19 } : { size: 19 }) })],
  });
  return [new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, widths[i], true)) }),
      ...rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, widths[i], false)) })),
    ],
  }), new Paragraph({ children: [], spacing: { after: 120 } })];
}

// ---------- contenu ----------
const dec = require('./decisions.js');
const c = [];

c.push(new Paragraph({ children: [new TextRun({ text: 'Stack d’observabilité Kubernetes pour le Projet 5', bold: true, size: 40 })], spacing: { after: 80 } }));
c.push(new Paragraph({ children: [new TextRun({ text: 'Monitoring Kubernetes clusters with AI — mise en place locale (Kind), puis cible AWS', size: 26, color: '595959' })], spacing: { after: 80 } }));
c.push(new Paragraph({ children: [new TextRun({ text: 'CloudSys / Cloud Services and Systems — HES-SO Master — document de travail, mis à jour le 25 octobre 2026', size: 20, color: '595959' })], spacing: { after: 240 } }));

c.push(new TableOfContents('Table des matières', { hyperlink: true, headingStyleRange: '1-2' }));

// 0
c.push(H1('0. À lire d’abord : ce qui a été vérifié, et ce qui ne l’a pas été'));
c.push(P('Ce document décrit comment installer **k8s-monitoring (Alloy), Loki, Mimir (sans MinIO), Grafana et Open WebUI**, d’abord à la main sur un cluster Kind, puis de façon automatisée (Switch Cloud, abandonné le 22.10.2026 au profit d’AWS : chapitre 6). Le « Step 3 » (Ollama + image FastAPI avec agent LangChain/LangGraph + liaison avec Open WebUI) a été réalisé en local sur Kind : la section 4 décrit ce qui a été fait et mesuré, les décisions retenues et leurs justifications.'));
c.push(P('**Mise à jour du 22.10.2026.** Le professeur a validé le travail local et demandé trois changements pour le cloud : **AWS** (région `us-east-1`) à la place de Switch Cloud, un **modèle public** (Amazon Bedrock) à la place du LLM hébergé, et un **assistant hors du cluster surveillé** (instance EC2). Le chapitre 6 consigne ces décisions, leurs justifications et ce qui a été vérifié ; la section 4.12 décrit la version 0.5.0 de l’assistant. Switch Cloud est abandonné ; les sections qui le décrivent sont conservées pour mémoire.'));
c.push(P('**Mise à jour du 25.10.2026.** L’infrastructure AWS (réseau, EKS, S3, droits) a été créée puis détruite avec des scripts le 23.10, puis recréée le 24.10. Mimir et Loki ont démarré sur EKS, mais Alloy et Grafana n’ont jamais été installés : les droits IAM et EKS de l’utilisateur ont été retirés le 24.10 à 15h17, sans cause connue, alors qu’un cluster de test était en marche. L’hôte EC2 (assistant et Open WebUI) est écrit et sa syntaxe est validée, mais il n’a jamais été lancé. Le plan de tests est écrit et ne contient encore aucun résultat. Détail : sections 6.10 à 6.13'));
c.push(P('**État des vérifications (16.10.2026).** L’environnement dans lequel ce document a été rédigé n’avait ni Kind, ni Helm, ni OpenTofu avec ses fournisseurs, et ne pouvait pas joindre ghcr.io, get.helm.sh ou releases.hashicorp.com : je n’ai donc exécuté aucune commande moi-même. **La partie 1 (installation manuelle sur Kind) a en revanche été exécutée par un membre du groupe sur un Mac, du 14 au 16 octobre 2026, et les sorties des commandes m’ont été transmises.** Ce qui a été constaté ainsi porte l’étiquette « observé sur Kind ». **Mise à jour du 19.10.2026 :** la partie de l’automatisation qui vise Kind (OpenTofu, scripts, Makefile, y compris Ollama, l’assistant et la configuration d’Open WebUI) a été exécutée par le même membre du groupe les 18 et 19 octobre, avec un test de fumée de 6 contrôles ; les résultats, les échecs rencontrés et leurs corrections sont en section 3.7. **Le déploiement sur Switch Cloud (dossier `envs/switch`, scripts `sck-*` et `scs3-*`) n’a jamais été exécuté.** Le Step 3 avait d’abord été exécuté à la main sur Kind (15 et 16 octobre). Sept étiquettes signalent le niveau de confiance :'));
c.push(note('obs', 'la commande a été exécutée sur le cluster Kind d’un membre du groupe et le résultat a été constaté (sortie de commande, requête, capture d’écran).'));
c.push(note('aws', 'la commande a été exécutée avec le CLI AWS par un membre du groupe, qui m’a transmis la sortie ; elle ne fait que lire (22.10.2026) ou, pour le test de l’assistant avec Bedrock, un appel de quelques fractions de cent.'));
c.push(note('eks', 'une commande ou un script a été exécuté sur AWS (EKS, S3, EC2) par un membre du groupe, qui a transmis les sorties (23 au 25.10.2026).'));
c.push(note('doc', 'le point a été lu dans la documentation officielle (lien dans la section Sources).'));
c.push(note('code', 'le point a été lu dans le code source (Open WebUI v0.12.0, code de l’assistant) ; le code lu est celui de la version déployée, mais lire n’est pas exécuter.'));
c.push(note('notest', 'la commande ou le code est cohérent avec la doc mais n’a jamais été exécuté. C’est le cas de tout ce qui vise Switch Cloud, abandonné (`envs/switch`, scripts `sck-*` et `scs3-*`, `switch-image`, `switch-apply`), et de tout ce qui vise AWS au-delà de ce qui est observé aux sections 6.10 et 6.11.'));
c.push(note('val', 'un détail n’a pas été trouvé dans la doc lue (clé de configuration, nom de service, format de sortie). Il est repris dans la liste des points ouverts (section 5).'));
c.push(P('Les fichiers (OpenTofu, valeurs Helm, scripts, Makefile) sont dans le dépôt GitLab du groupe (dossier racine `k8s-observability`) ; ce document est dans `docs/`, ses sources dans `docs/guide-src/` (`make docs` le régénère). La partie 1 et le Step 3 ont été déroulés sur Kind et ce document a été corrigé en conséquence ; la partie 2 reste à tester. Le code de l’assistant est dans `assistant/`, ses manifestes dans `manual/local/`.'));

// 1
c.push(H1('1. Architecture cible'));
c.push(P('Le schéma du projet est : cluster K8s → observabilité (Prometheus/Mimir + Loki) → agent IA → interface. Les traces sont explicitement hors périmètre. La stack installée ici couvre les deux couches du bas, plus Open WebUI, Ollama et l’assistant (Step 3).'));
c.push(...code(
`Cluster K8s
  ├─ k8s-monitoring (Alloy Operator + collecteurs Alloy)
  │     ├─ métriques ──remote write──▶ Mimir ──▶ stockage objet S3
  │     └─ logs / événements ─────────▶ Loki  ──▶ stockage objet S3
  ├─ Grafana      (datasources : Mimir + Loki)
  ├─ Ollama       (qwen3:8b, sur CPU) ◀── utilisé par Open WebUI et par l'assistant
  ├─ assistant    (FastAPI + agent LangGraph) ──▶ Mimir et Loki (lecture seule) + Ollama
  └─ Open WebUI   (modèle Ollama + outil ask_cluster_assistant ──▶ assistant)`));
c.push(...table(
  ['Outil', 'Chart Helm (dépôt)', 'Namespace', 'Rôle'],
  [
    ['Garage (local seulement)', 'chart dans le dépôt git Garage (pas de dépôt Helm)', '`garage`', 'Stockage S3 pour Mimir et Loki sans MinIO'],
    ['Mimir', '`mimir-distributed` (`grafana`)', '`mimir`', 'Stockage des métriques'],
    ['Loki', '`loki` (`grafana-community`)', '`loki`', 'Stockage des logs'],
    ['k8s-monitoring', '`k8s-monitoring` (`grafana`)', '`monitoring`', 'Collecte (Alloy) métriques, logs, événements'],
    ['Grafana', '`grafana` (`grafana-community`)', '`grafana`', 'Visualisation, vérification des données'],
    ['Open WebUI', '`open-webui` (`https://helm.openwebui.com/`)', '`open-webui`', 'Interface de chat pour l’agent'],
    ['Ollama (Step 3)', '`ollama` du dépôt `otwld` 1.88.0 (`https://helm.otwld.com/`, à confirmer)', '`ollama`', 'Serveur du LLM (qwen3:8b)'],
    ['Assistant (Step 3)', 'aucun chart : image locale + `manual/local/assistant.yaml`', '`assistant`', 'API FastAPI et agent (lecture seule)'],
  ],
  [1700, 3000, 1400, 3538]));
c.push(note('doc', 'dépôts : `grafana` = `https://grafana.github.io/helm-charts` (Mimir, k8s-monitoring) ; `grafana-community` = `https://grafana-community.github.io/helm-charts` (Loki, depuis le 16.03.2026) ; Open WebUI = `https://helm.openwebui.com/`.'));
c.push(note('obs', 'chart Grafana : `grafana-community/grafana` 14.0.0 (Grafana 13.2.4) a été installé et fonctionne. L’ancien `grafana/grafana` était, au même moment, en 10.5.15 (Grafana 12.3.1). Une annonce Grafana (13.01.2026) confirme une migration vers `grafana-community`, mais ne cite pas le chart Grafana : que l’ancien chart soit officiellement abandonné n’est pas établi.'));

c.push(P('**Mise à jour du 22.10.2026.** Le schéma ci-dessus décrit la version locale. Pour le déploiement cloud, l’architecture évolue (AWS, Amazon Bedrock à la place d’Ollama, assistant et Open WebUI sur une instance EC2 hors du cluster) : voir le chapitre 6.'));

// 2 Partie 1
c.push(H1('2. Partie 1 — Installation manuelle en local (Kind, macOS)'));
c.push(H2('2.1 Prérequis'));
c.push(B('**Docker Desktop** avec au moins 16 Go de RAM alloués (vous avez indiqué en disposer). La doc de démarrage de Mimir annonce un minimum de 4 cœurs et 16 GiB pour un nœud unique.'));
c.push(B('**kind** : `brew install kind` (version stable indiquée par la doc : v0.33.0).'));
c.push(B('**kubectl** et **helm** (>= 3.8 requis par la doc Mimir ; testé avec Helm v4.3.0) :`brew install kubectl helm`.'));
c.push(B('**git**, et pour la partie 2 **OpenTofu** (`brew install opentofu`, commande `tofu`).'));
c.push(note('doc', 'Kind (`brew install kind`), Helm >= 3.8 et Kubernetes >= 1.32 pour Mimir sont dans les docs. Kubernetes >= 1.25 pour Loki.'));
c.push(note('obs', 'Kind v0.33.0 (nœuds Kubernetes v1.37.0, donc >= 1.32), Helm v4.3.0 et Garage v2.4.1 ont été utilisés. Avec Helm 4, les options `--wait`, `--timeout`, `--create-namespace`, `-f` et `--version` employées dans ce document ont fonctionné.'));
c.push(note('val', 'les noms exacts des formules Homebrew `kubectl`, `helm`, `opentofu` sont de mémoire. Vérifiez avec `brew search`.'));

c.push(H2('2.2 Créer le cluster Kind'));
c.push(...code(
`cd k8s-observability
kind create cluster --config kind/kind-config.yaml --wait 5m
kubectl config use-context kind-k8s-ai-monitoring
kubectl get nodes`));
c.push(P('Le fichier `kind/kind-config.yaml` définit un control-plane et deux workers (`apiVersion: kind.x-k8s.io/v1alpha4`). Le contexte kubectl est `kind-<nom du cluster>`. Les services sont atteints par `kubectl port-forward`, donc aucun `extraPortMappings`.'));
c.push(note('doc', 'commande `kind create cluster --config`, option `--wait`, format de config, nom de contexte `kind-<nom>`.'));
c.push(note('obs', 'cluster créé avec 1 control-plane et 2 workers ; les 3 nœuds sont `Ready` en version v1.37.0.'));

c.push(H2('2.3 Stockage objet local : Garage (à la place de MinIO)'));
c.push(P('**Pourquoi un S3 est nécessaire.** En désactivant MinIO (`minio.enabled: false`), le chart Mimir exige un stockage objet externe via `mimir.structuredConfig`. La doc Mimir lue liste S3 (et compatibles), GCS, Azure et Swift ; elle ne mentionne pas de backend « filesystem » pour les blocs. Loki a le même besoin : son sous-chart MinIO est déprécié et son retrait est annoncé pour le **31.10.2026**, soit dans moins de trois semaines.'));
c.push(P('Vous avez choisi **Garage**, un serveur S3 léger, pour le local. L’interprétation « sans MinIO » du professeur reste à confirmer (section 5) : elle pourrait simplement signifier « ne pas accepter l’option MinIO proposée par une procédure d’installation ».'));
c.push(...code(
`git clone https://git.deuxfleurs.fr/Deuxfleurs/garage .work/garage
cd .work/garage/script/helm
helm install --create-namespace --namespace garage garage ./garage \\
  --set garage.singleNode=true \\
  --set persistence.meta.size=1Gi --set persistence.data.size=10Gi
kubectl exec -n garage garage-0 -- ./garage status`));
c.push(P('Ensuite, créez la clé d’accès et les buckets. En mode `singleNode`, le layout est appliqué automatiquement : aucune commande `layout` n’est nécessaire. Sous zsh, utilisez une fonction plutôt qu’une variable contenant la commande (zsh ne découpe pas les variables en mots) :'));
c.push(...code(
`g() { kubectl exec -n garage garage-0 -c garage -- ./garage "$@"; }
g status
g key create observability-key        # notez Key ID et Secret key (à ne jamais coller dans un chat ou un dépôt)
for b in mimir-blocks mimir-alertmanager mimir-ruler loki-chunks loki-ruler loki-admin; do
  g bucket create $b
  g bucket allow --read --write --owner $b --key observability-key
done
g bucket list`));
c.push(note('doc', 'chart Garage dans `script/helm`, commande `helm install ... ./garage`, valeurs `garage.singleNode`, `persistence.meta/data`, `kubectl exec ... ./garage status`, commandes `layout assign/apply`, `bucket create`, `key create`, `bucket allow`, port S3 3900, région `garage`.'));
c.push(note('obs', 'Garage v2.4.1 installé depuis le dépôt git cloné. En mode `singleNode`, le layout a été appliqué automatiquement (aucune commande `layout` utilisée). La clé `observability-key` et les 6 buckets ont été conservés après l’extinction puis le redémarrage de la machine. Le service S3 `garage.garage.svc.cluster.local:3900` (région `garage`) est celui utilisé par Mimir et Loki. Écritures prouvées : 98 objets (935 ko) dans `loki-chunks` et 20 objets (5,0 Mo) dans `mimir-blocks`, relevés avec `g bucket info <bucket>`.'));

c.push(H2('2.4 Mimir (sans MinIO)'));
c.push(P('Les fichiers de valeurs prêts à l’emploi pour le local sont dans `manual/local/` et contiennent des espaces réservés (`REPLACE_ACCESS_KEY`, `REPLACE_SECRET_KEY`). **Ne les modifiez pas** : créez une copie dans `.work/` (ignoré par git) avec la clé de l’étape précédente, exportée dans les variables `ACCESS_KEY` et `SECRET_KEY` :'));
c.push(...code(
`helm repo add grafana https://grafana.github.io/helm-charts
helm repo add grafana-community https://grafana-community.github.io/helm-charts
helm repo update
sed -e "s/REPLACE_ACCESS_KEY/$ACCESS_KEY/" -e "s/REPLACE_SECRET_KEY/$SECRET_KEY/" \\
  manual/local/mimir.yaml > .work/mimir.yaml
helm -n mimir install mimir grafana/mimir-distributed --version 6.2.1 --create-namespace \\
  -f .work/mimir.yaml --wait --timeout 15m
kubectl -n mimir get pods`));
c.push(P('Contenu essentiel du fichier : `minio.enabled: false`, puis `mimir.structuredConfig` avec `common.storage.backend: s3`, l’endpoint Garage, et trois buckets distincts (`blocks_storage`, `alertmanager_storage`, `ruler_storage`).'));
c.push(note('doc', 'commande d’installation, `minio.enabled: false`, structure `structuredConfig` avec trois buckets, le chart déploie par défaut Kafka embarqué (réservé aux démos), le nom du service `mimir-gateway`, URL de lecture `/prometheus` et d’écriture `/api/v1/push`.'));
c.push(note('obs', 'chart `mimir-distributed` 6.2.1 (Mimir 3.2.1). Avec `insecure: true` et `bucket_lookup_type: path`, Mimir fonctionne avec Garage. Au premier démarrage, plusieurs pods (ingester, distributor, ruler) redémarrent 3 à 4 fois ; la cause est confirmée pour l’ingester (il attend que Kafka soit prêt), puis tout passe `Running` sans intervention. La passerelle accepte les requêtes sans en-tête `X-Scope-OrgID` (lecture sous `/prometheus`). Les blocs sont écrits dans Garage, mais pas tout de suite : `mimir-blocks` ne contenait qu’un objet de 92 octets environ 2 h 20 après le début de la collecte, puis 20 objets (5,0 Mo) environ 3 h 20 après.'));
c.push(P('Le chart active par défaut l’architecture « ingest storage » avec un Kafka embarqué. La doc précise qu’en production il faut un Kafka externe ; ici on garde l’embarqué pour un test.'));

c.push(H2('2.5 Loki'));
c.push(...code(
`sed -e "s/REPLACE_ACCESS_KEY/$ACCESS_KEY/" -e "s/REPLACE_SECRET_KEY/$SECRET_KEY/" \\
  manual/local/loki.yaml > .work/loki.yaml
helm -n loki install loki grafana-community/loki --version 18.15.1 --create-namespace \\
  -f .work/loki.yaml --wait --timeout 15m
kubectl -n loki get pods`));
c.push(P('Points clés du fichier : `deploymentMode: Monolithic`, `singleBinary.replicas: 1`, `loki.commonConfig.replication_factor: 1` (obligatoire avec une seule réplique), schéma TSDB v13 sur `object_store: s3`, `minio.enabled: false`, stockage S3 vers Garage, et les autres modes de déploiement mis à zéro réplique. Les caches `chunksCache` et `resultsCache` sont coupés en local pour économiser la RAM.'));
c.push(note('doc', 'dépôt `grafana-community`, structure du fichier de valeurs monolithique, exemple S3 (endpoint, region, accessKeyId, secretAccessKey, s3ForcePathStyle, insecure), avertissement sur les noms de buckets par défaut (`chunk`, `ruler`, `admin`), noms des clés `chunksCache`/`resultsCache` (README du chart).'));
c.push(note('doc', 'avec `auth_enabled: false`, Loki utilise un seul tenant (`fake`) et l’en-tête `X-Scope-OrgID` n’est pas requis (doc multi-tenancy Loki).'));
c.push(note('obs', 'chart `loki` 18.15.1 (Loki 3.7.8). Le service `loki-gateway` (port 80) existe ; `loki.auth_enabled: false` fonctionne (requêtes acceptées sans `X-Scope-OrgID`) ; les caches désactivés n’empêchent pas le démarrage. Pods `loki-0` (2/2), `loki-gateway` et `loki-canary` `Running`. Loki écrit bien dans Garage : 98 objets (935 ko) dans `loki-chunks`.'));

c.push(H2('2.6 k8s-monitoring (Alloy)'));
c.push(...code(
`# 1. valider les valeurs contre le schéma du chart (ne touche pas au cluster)
helm template k8s-monitoring grafana/k8s-monitoring --version 4.5.3 --namespace monitoring \\
  -f manual/local/k8s-monitoring.yaml > /dev/null
# 2. installer
helm upgrade --install k8s-monitoring grafana/k8s-monitoring --version 4.5.3 \\
  --namespace monitoring --create-namespace \\
  -f manual/local/k8s-monitoring.yaml --wait --timeout 10m
kubectl -n monitoring get pods
kubectl -n monitoring get alloy`));
c.push(P('Le chart installe l’Alloy Operator, qui crée dynamiquement des instances Alloy selon vos « collectors ». Notre fichier en définit trois : `alloy-metrics` (presets `clustered`, `statefulset`), `alloy-singleton` (preset `singleton`, pour les événements du cluster) et `alloy-logs` (presets `filesystem-log-reader`, `daemonset`). Deux destinations : `prometheus` (vers `mimir-gateway`) et `loki` (vers `loki-gateway`). Les métriques de nœud (Node Exporter) ne sont pas incluses : le rendu Helm ne contient aucune mention de `node-exporter`.'));
c.push(note('doc', 'dépôt et nom du chart, notions de collector / preset / destination / feature, noms des presets, champ `collector` par feature, `telemetryServices.kube-state-metrics.deploy`, features `clusterMetrics` et `clusterEvents`, destinations de type `prometheus` et `loki`.'));
c.push(note('obs', 'avec `destinations` écrit comme un tableau (comme dans la v3), `helm template` échoue : « values don’t meet the specifications of the schema … at /destinations: got array, want object ». En v4, `destinations` est un **objet** (une clé par destination), ce que confirme le guide de migration v4. `podLogsViaLoki` et `clusterEvents` sont acceptés, et le rendu contient la collecte des événements (`kubernetes_events`) et 3 ressources `Alloy`.'));
c.push(note('obs', 'chart 4.5.3 installé : 7 pods `Running` sans redémarrage (3 `alloy-logs` en DaemonSet, `alloy-metrics`, `alloy-singleton`, `alloy-operator`, `kube-state-metrics`) et 3 ressources `Alloy`. Mimir reçoit 11 cibles (`count(up)`) ; Loki reçoit les logs de pods (labels `namespace`, `pod`, `container`…). La présence des événements Kubernetes dans Loki n’a pas été vérifiée séparément. Au démarrage, `alloy-metrics` émet un avertissement (« failed to resolve provided join address ») puis crée son propre cluster : sans conséquence avec une seule réplique, cause non vérifiée.'));

c.push(H2('2.7 Grafana'));
c.push(...code(
`read -s "GP?Mot de passe admin Grafana : "; echo      # zsh ; ne pas l'afficher
sed "s/REPLACE_GRAFANA_PASSWORD/$GP/" manual/local/grafana.yaml > .work/grafana.yaml; unset GP
helm upgrade --install grafana grafana-community/grafana --version 14.0.0 \\
  --namespace grafana --create-namespace -f .work/grafana.yaml --wait --timeout 5m
kubectl -n grafana port-forward svc/grafana 3000:80`));
c.push(P('Ouvrez http://localhost:3000, utilisateur `admin`. Les datasources Mimir (`http://mimir-gateway.mimir.svc.cluster.local/prometheus`) et Loki (`http://loki-gateway.loki.svc.cluster.local`) sont provisionnées par le fichier de valeurs.'));
c.push(note('doc', 'URL de la datasource Mimir avec le suffixe `/prometheus`, utilisateur initial `admin` (doc Mimir).'));
c.push(note('obs', 'chart `grafana-community/grafana` 14.0.0. Les deux datasources provisionnées répondent `OK` (API `/api/datasources/uid/<uid>/health`), et les requêtes `count(up)` (Mimir) et `{namespace="monitoring"}` (Loki) donnent des résultats dans Explore. Le service écoute sur le port 80. La persistance est désactivée (`persistence.enabled: false`, avertissement de Helm) : les dashboards et comptes créés dans l’interface sont perdus au redémarrage du pod ; les datasources, elles, sont recréées par le fichier de valeurs.'));

c.push(H2('2.8 Open WebUI'));
c.push(...code(
`helm repo add open-webui https://helm.openwebui.com/
helm repo update
sed "s/REPLACE_WEBUI_SECRET/$(openssl rand -hex 32)/" manual/local/open-webui.yaml > .work/open-webui.yaml
helm upgrade --install open-webui open-webui/open-webui --version 17.0.0 \\
  --namespace open-webui --create-namespace -f .work/open-webui.yaml --wait --timeout 10m
kubectl -n open-webui port-forward svc/open-webui 8081:80`));
c.push(P('Le fichier désactive les composants embarqués inutiles pour l’instant : `ollama.enabled: false`, `pipelines.enabled: false`, `enableOpenaiApi: false`, et fixe WebSocket sans Redis (une seule réplique, comme le recommande le guide Kubernetes d’Open WebUI). Open WebUI n’a pas de modèle propre : il est relié à un Ollama séparé, dans le namespace `ollama`, par la clé `ollamaUrls` (`http://ollama.ollama.svc.cluster.local:11434`). Ollama, l’assistant et les réglages à faire dans l’interface sont décrits en section 4.'));
c.push(note('doc', 'dépôt Helm, clés `ollama.enabled`, `pipelines.enabled`, `websocket`, `enableOpenaiApi`, `persistence`, `service` et leurs valeurs par défaut (lues dans le values.yaml du chart) ; « Open WebUI has no models of its own » ; premier compte créé = administrateur.'));
c.push(note('doc', 'guide Kubernetes d’Open WebUI (13.10.2026) : une réplique = `websocket.enabled: true`, `manager: ""`, `redis.enabled: false` ; Redis seulement avec plusieurs répliques.'));
c.push(note('obs', '`https://helm.openwebui.com/` fonctionne : chart `open-webui` 17.0.0 (application 0.12.0). L’autre URL citée par le guide Kubernetes (`open-webui.github.io/helm-charts`) n’a pas été testée. Les clés du fichier existent toutes à la racine du `values.yaml` 17.0.0 (les sous-clés de `websocket` n’ont pas été contrôlées une par une) ; le rendu contient un StatefulSet, un Service, un ServiceAccount et un PVC, sans Ollama, pipelines ni Redis. Le pod `open-webui-0` est `Running` sans redémarrage ; l’interface répond sur le port local 8081 (port du conteneur : 8080) et le premier compte a pu être créé. L’interface propose la version 0.12.2 : non appliquée, pour garder une installation reproductible. Avant le branchement d’Ollama (Step 3), aucun modèle n’était sélectionnable.'));

c.push(H2('2.9 Vérifier et apprendre à récupérer les données'));
c.push(P('Le Step 3 consistera à exposer des endpoints FastAPI qui renvoient métriques et logs. Il faut donc savoir interroger Mimir et Loki. Depuis votre Mac, via port-forward :'));
c.push(...code(
`kubectl -n mimir port-forward svc/mimir-gateway 8081:80 &
curl -s 'http://localhost:8081/prometheus/api/v1/query?query=up' | head -c 600

kubectl -n loki port-forward svc/loki-gateway 8082:80 &
curl -sG 'http://localhost:8082/loki/api/v1/query_range' \\
  --data-urlencode 'query={namespace="kube-system"}' --data-urlencode 'limit=5' | head -c 600`));
c.push(P('Depuis un pod du cluster (cas de l’agent FastAPI), utilisez les noms de services internes : `http://mimir-gateway.mimir.svc.cluster.local/prometheus` et `http://loki-gateway.loki.svc.cluster.local`. Dans Grafana, onglet Explore : la requête PromQL `up` sur Mimir et la requête LogQL `{namespace="kube-system"}` sur Loki doivent renvoyer des résultats.'));
c.push(note('doc', 'préfixe `/prometheus` côté Mimir.'));
c.push(note('obs', '`/prometheus/api/v1/query?query=count(up)` renvoie 11 ; `/prometheus/api/v1/label/namespace/values` liste `default`, `garage`, `kube-system`, `loki`, `mimir`, `monitoring` (entre autres) ; Loki expose les labels `namespace`, `pod`, `container`, `job`, `level`, `reason`, `k8s_cluster_name`… et `/loki/api/v1/query_range` renvoie des lignes de log.'));
c.push(note('val', 'le graphique `count(up)` dans Grafana montre des creux, puis un trou d’environ 15 minutes (de 19:57 à 20:12 environ) pendant que la machine était probablement en veille ; la cause n’a pas été vérifiée. Une collecte continue n’est donc pas garantie quand le Mac s’endort.'));

c.push(H2('2.10 Nettoyage'));
c.push(...code('kind delete cluster --name k8s-ai-monitoring'));
c.push(P('Cela supprime le cluster, donc aussi Garage et toutes les données.'));

// 3 Partie 2
c.push(H1('3. Partie 2 — Automatisation (local) ; Switch Cloud abandonné'));
c.push(P('**Mise à jour du 22.10.2026 : Switch Cloud est abandonné** (retour du professeur ; chapitre 6). Les sections 3.4 et 3.5 sont conservées pour mémoire : elles n’ont jamais été exécutées et ne sont plus maintenues. Le reste de cette partie (automatisation locale) reste valable.'));
c.push(H2('3.1 Choix de l’outil d’infrastructure as code'));
c.push(P('Vous aviez demandé un langage de script pour tout déployer, en local comme dans le cloud, et m’avez laissé le choix. J’ai retenu **OpenTofu avec le provider Helm** (option que vous avez confirmée comme recommandée). **Vocabulaire :** Terraform est l’outil d’origine (HashiCorp), dont la licence n’est plus libre depuis 2023 ; OpenTofu en est un fork libre (Linux Foundation) qui lit les mêmes fichiers `.tf` et utilise les mêmes fournisseurs ; seule la commande change (`tofu` au lieu de `terraform`). Nous avons décidé d’utiliser **OpenTofu** seul : licence libre, `tofu` est la valeur par défaut du Makefile, et c’est l’outil avec lequel le code a été validé (version 1.10.6 côté rédaction, 1.13.1 sur le Mac du groupe). « Terraform » ne désigne plus dans ce document que le format des fichiers (`terraform.tfvars`, `.tfstate`) ou le nom du fournisseur.'));
c.push(...table(
  ['Option', 'Avantages', 'Limites pour ce projet'],
  [
    ['**OpenTofu + provider Helm** (retenu)', 'Un seul module décrit la stack ; les environnements `local` et `switch` ne diffèrent que par leurs variables. Plan/apply et état. Langage répandu, utile pour d’autres cours cloud.', 'Un outil de plus à installer. Le provider Helm 2.x est épinglé : la 3.x change la syntaxe (non vérifié). Le fichier d’état contient les secrets en clair.'],
    ['Helmfile', 'Très proche de Helm, une seule déclaration des releases, environnements natifs.', 'Ne crée pas d’infrastructure. Il faudrait un autre outil pour le cluster.'],
    ['Scripts bash + `helm`', 'Aucun outil supplémentaire, transparent.', 'Pas d’état ni de plan, idempotence à écrire soi-même, difficile à maintenir.'],
    ['Argo CD / Flux (GitOps)', 'Déploiement continu depuis git.', 'Surdimensionné pour un projet de quelques semaines.'],
  ],
  [2200, 3719, 3719]));
c.push(P('Cette comparaison est un jugement de ma part, pas une mesure. Une limite honnête de mon choix : **le cluster SCK lui-même n’est pas créé par OpenTofu**. La doc Switch décrit une création par le portail ou par l’API KKP, et ne mentionne aucun fournisseur Terraform/OpenTofu ; je n’en ai pas supposé un. OpenTofu ne gère donc que ce qui est installé *dans* le cluster. La création du cluster reste une étape manuelle ou un script d’appel à l’API.'));

c.push(H2('3.2 Structure du dépôt'));
c.push(...code(
`k8s-observability/
├─ kind/kind-config.yaml               cluster local
├─ modules/observability/              module partagé (Mimir, Loki, k8s-monitoring, Grafana, Open WebUI, Ollama, assistant)
│   ├─ main.tf, llm.tf, variables.tf, versions.tf
│   └─ values/*.yaml.tftpl             valeurs Helm paramétrées
├─ charts/assistant/                   chart Helm local de l’assistant (image, variables d’environnement, sonde)
├─ envs/local/                         Garage + module (cluster Kind)
├─ envs/switch/                        module seul (cluster SCK + SCS3) : ABANDONNÉ, jamais exécuté
├─ envs/aws/                           (à venir) EKS, S3, instance EC2
├─ scripts/
│   ├─ preflight.sh, gen-secrets.sh    pré-contrôles ; secrets aléatoires (jamais dans le dépôt)
│   ├─ garage-init.sh                  layout, buckets, clé Garage (local)
│   ├─ webui-bootstrap.sh              entrée de modèle d’Open WebUI (prompt système, num_ctx, think)
│   ├─ smoke-test.sh, credentials.sh   test de fumée en 6 contrôles ; relecture des identifiants
│   ├─ scs3-create-buckets.sh          buckets sur SCS3 (cloud)
│   └─ sck-create-cluster.sh           appel à l'API KKP (cloud)
├─ manual/local/*.yaml                 valeurs rendues pour l'installation manuelle (partie 1)
├─ docs/                               ce guide (DOCX), ses sources (guide-src/), le document d’architecture rendu
└─ Makefile`));
c.push(P('Le même module `observability` est appelé par les deux environnements. Seules changent les variables : endpoint S3, région, TLS, préfixe de buckets, secrets.'));

c.push(H2('3.3 Déploiement local automatisé'));
c.push(...code(
`make preflight          # outils, mémoire Docker, clusters Kind existants
make local-secrets       # secrets aléatoires -> envs/local/secrets.auto.tfvars.json (jamais écrasés)
make local-up            # kind create cluster
make local-garage        # clone Garage (commit figé), tofu apply (phase 1 : Garage seul)
make local-garage-init   # layout, buckets, clé -> envs/local/s3.auto.tfvars.json
make local-assistant-image  # docker build de l’assistant, chargé dans Kind
make local-stack         # tofu apply (phase 2 : Mimir, Loki, k8s-monitoring, Grafana, Ollama, assistant, Open WebUI)
make local-webui-config  # entrée de modèle d’Open WebUI (prompt système, num_ctx, think: false)
make local-test          # test de fumée, 6 contrôles
make local-credentials   # identifiants Open WebUI et Grafana
# ou tout d’un coup : make local-all
make local-down          # supprime le cluster et l’état OpenTofu local (les secrets sont conservés)`));
c.push(P('Le déploiement se fait en deux phases : la clé S3 n’existe qu’après l’initialisation de Garage, et OpenTofu en a besoin pour configurer Mimir et Loki. La variable `deploy_stack` pilote cette bascule. Le Makefile lance `tofu` (variable `TF`) ; `TF=terraform` fonctionnerait en principe mais n’est pas le choix retenu.'));
c.push(note('obs', 'le module OpenTofu, les scripts et le Makefile de l’environnement local ont été exécutés sur Kind les 18 et 19 octobre 2026 : `tofu validate` avec le vrai fournisseur, déploiement de sept ressources Helm, test de fumée à 6 contrôles. Détails, échecs et corrections : section 3.7. Le gabarit corrigé pour `destinations` (objet et non tableau) a donc été exécuté. Reste non exécuté : tout ce qui vise Switch Cloud.'));

c.push(H2('3.4 Switch Cloud : ce que la documentation dit'));
c.push(P('Contrairement à l’hypothèse de départ (un cluster Kubernetes monté soi-même sur OpenStack), Switch Cloud propose un **Kubernetes managé (SCK)**, basé sur KKP (Kubermatic), et un **stockage objet S3 (SCS3)**.'));
c.push(B('Les clusters SCK sont déployés sur **Switch Cloud Compute, qui repose sur OpenStack**. Le CNI par défaut est Cilium ; la stratégie d’exposition par défaut est `LoadBalancer` (Octavia pour l’API server).'));
c.push(B('Création par le portail (projet SCK lié à un projet du portail, clés SSH à ajouter dès la création, preset de fournisseur avec compte de service, MachineDeployment initial avec flavor, taille de disque, image) ou par l’API KKP.'));
c.push(B('API KKP : base `https://sck.cloud.switch.ch`, `POST /api/v2/projects/<project_id>/clusters`, jeton Bearer d’un compte de service avec le groupe Editor. L’exemple de la doc utilise le datacenter `scc-zhw`, Kubernetes 1.33.3, un flavor `c002r002`, l’image Ubuntu 24.04 (Switch Cloud) et un disque de 20 Go : ce sont des **valeurs d’exemple, pas des recommandations de dimensionnement**.'));
c.push(B('Si la plage d’IP autorisées pour l’API reste vide, l’accès est ouvert à toutes les IP (défaut de la doc) : restreignez-la.'));
c.push(note('doc', 'tout le contenu de cette section provient des pages Switch « Create a Cluster » et « Create a Cluster Using the KKP API » et de l’index de documentation.'));
c.push(note('val', 'non trouvés dans les pages lues : l’endpoint S3 de SCS3, la méthode d’obtention des clés S3, la région, le téléchargement du kubeconfig par API, les classes de stockage, les tarifs et quotas, l’existence d’un fournisseur OpenTofu/Terraform pour KKP. Le contenu du JSON de création de cluster (`cluster-no-md.json`) n’était pas visible : je n’ai donc pas écrit ce JSON, `sck-create-cluster.sh` l’attend en argument.'));

c.push(H2('3.5 Déployer sur Switch Cloud, pas à pas'));
c.push(N('**Créer le cluster SCK** par le portail (plus sûr pour une première fois), ou avec `scripts/sck-create-cluster.sh <project_id> cluster.json` en reprenant le JSON de la doc Switch. Dimensionnez les nœuds pour Mimir : la doc de démarrage annonce 4 cœurs et 16 GiB pour un nœud unique. Consultez la page « Flavors » de Switch pour choisir.'));
c.push(N('**Télécharger le kubeconfig** du cluster depuis le portail, par exemple vers `~/.kube/sck-switch.yaml`, puis `kubectl --kubeconfig ~/.kube/sck-switch.yaml get nodes`.'));
c.push(N('**Créer les buckets SCS3** : relever endpoint, région et clés dans la doc/portail SCS3, puis `scripts/scs3-create-buckets.sh` (AWS CLI). Choisissez un préfixe de buckets unique (ex. `votregroupe-`) ; l’unicité globale des noms n’est pas confirmée.'));
c.push(N('**Renseigner** `envs/switch/terraform.tfvars` à partir de `terraform.tfvars.example` (secrets : fichier ignoré par git).'));
c.push(N('**Déployer** : `cd envs/switch && tofu init && tofu plan && tofu apply`.'));
c.push(N('**Vérifier** : `kubectl get pods -A`, puis port-forward Grafana et mêmes requêtes qu’en 2.9.'));
c.push(...table(
  ['Paramètre', 'Local (Kind)', 'Switch Cloud'],
  [
    ['Cluster', 'Kind, créé par `make local-up`', 'SCK, créé par portail ou API KKP'],
    ['Stockage objet', 'Garage dans le cluster, HTTP', 'SCS3, HTTPS (`s3_insecure = false`)'],
    ['Buckets', 'Sans préfixe', 'Avec préfixe unique'],
    ['Caches Loki', 'Désactivés', 'Désactivés par défaut, activables'],
    ['Accès aux interfaces', '`kubectl port-forward`', '`kubectl port-forward` (aucun Ingress créé)'],
    ['Secrets', 'Générés aléatoirement par `make local-secrets` (jamais dans le dépôt)', '`make switch-secrets` pour les mots de passe d’application ; clés S3 SCS3 à fournir, jamais committées'],
  ],
  [2200, 3719, 3719]));

c.push(H2('3.6 Coûts, sécurité, nettoyage'));
c.push(B('**Coûts** : je n’ai trouvé aucun tarif dans les pages lues. Vérifiez la facturation du projet avant de laisser tourner le cluster. Détruisez-le quand vous ne travaillez pas dessus.'));
c.push(B('**Secrets** : les clés S3 et mots de passe passent par des variables OpenTofu sensibles, mais ils sont écrits dans le fichier d’état et dans les ConfigMaps rendues par les charts. Pour un usage au-delà du test, passez par des Secrets Kubernetes. Ne commitez jamais `terraform.tfvars`, `*.tfstate` ni `s3.auto.tfvars.json` (déjà dans `.gitignore`).'));
c.push(B('**Nettoyage cloud** : `tofu destroy` dans `envs/switch`, puis suppression du cluster SCK et des buckets SCS3 (les volumes persistants et buckets peuvent survivre au cluster).'));
c.push(B('**Versions** : versions réellement installées sur Kind le 15.10.2026 : `loki` 18.15.1 (Loki 3.7.8), `k8s-monitoring` 4.5.3, `grafana` (grafana-community) 14.0.0 (Grafana 13.2.4), `open-webui` 17.0.0 (application 0.12.0), `mimir-distributed` 6.2.1 (Mimir 3.2.1), chart Garage 0.10.3 (Garage v2.4.1), Kind v0.33.0, Helm v4.3.0. Relevé avec `helm list -A` ; les collecteurs créés par l’opérateur utilisent le chart `alloy` 1.13.0 (Alloy v1.20.0). Step 3 (relevé dans les sorties de commandes du 16.10.2026) : chart `ollama` (otwld) 1.88.0 (Ollama 0.40.3), modèle `qwen3:8b`, image locale `assistant:0.4.3` (0.4.1 le 16.10.2026). Le module OpenTofu fige par défaut les cinq charts (Mimir, Loki, k8s-monitoring, Grafana, Open WebUI) via `chart_versions` ; sans version figée, un redéploiement pourrait donner un résultat différent.'));

c.push(H2('3.7 Résultats de l’automatisation locale (18 et 19 octobre 2026)'));
c.push(P('Les commandes ont été exécutées par un membre du groupe sur un Mac (Apple silicon, Docker Desktop avec 10 CPU et 15 Gio) avec OpenTofu 1.13.1, le provider Helm `hashicorp/helm` 2.17.0, Helm 4.3.1, kubectl 1.37.1, Kind 0.33.0 et Docker 29.8.2 ; les sorties m’ont été transmises. De mon côté, je n’ai pu faire que du formatage (`tofu fmt`) et l’évaluation hors ligne des expressions du module.'));
c.push(note('obs', '`tofu init` et `tofu validate` dans `envs/local` : « Success » avec le vrai fournisseur (19.10). Reconstruction complète `make local-down && make local-all` du 19.10 : cluster, Garage et clés S3, image de l’assistant, sept ressources OpenTofu (« Apply complete! Resources: 7 added »), entrée de modèle Open WebUI créée, test de fumée. Sur ce cluster, les 6 contrôles du test sont passés après correction du contrôle 1 (premier contrôle des pods : faux échec, voir ci-dessous).'));
c.push(note('obs', 'exécution d’un seul tenant, sans aucune intervention, de `make local-down && make local-all` (19.10, soir) : cluster, Garage et clés, image de l’assistant, sept ressources OpenTofu, entrée de modèle Open WebUI créée (`think: false` par défaut), test de fumée « Tous les contrôles sont passés » (6 sur 6), identifiants affichés. Les secrets existants ont été conservés (« existe déjà »). C’est la quatrième exécution complète : les trois précédentes ont échoué chacune pour une attente trop courte (délai Open WebUI, contrôle des pods, configuration d’Open WebUI), corrigée à chaque fois. Une seule réussite ne prouve pas la fiabilité : les durées d’attente restent liées aux téléchargements, donc au réseau.'));
c.push(...table(
  ['Ressource (19.10, 2e exécution)', 'Durée de création', 'Remarque'],
  [
    ['Loki', '7 min 35 s', ''],
    ['Mimir', '8 min 12 s', 'Redémarrages au premier démarrage (voir ci-dessous)'],
    ['Grafana', '4 min 50 s', ''],
    ['k8s-monitoring', '10 min 48 s', '9 min 43 s lors de la 1re exécution du 19.10 ; 8 min 7 s lors d’une exécution précédente'],
    ['Open WebUI', '8 min 56 s', 'Dominé par le téléchargement de l’image (1,46 Go) ; 10 min 24 s lors de l’exécution suivante'],
    ['Ollama', '15 min 11 s', 'Le pod n’est prêt qu’après le téléchargement du modèle ; 16 min 17 s et 20 min 51 s lors d’exécutions précédentes'],
    ['Assistant', '5 s', 'Image locale déjà chargée dans Kind'],
  ],
  [3000, 2200, 4438]));
c.push(P('Lors de l’exécution réussie d’un seul tenant (19.10, soir), les durées étaient : Loki 5 min 31 s, Mimir 7 min 17 s, Grafana 6 min 12 s, Ollama 16 min 22 s, Open WebUI 10 min 0 s, k8s-monitoring 13 min 28 s, assistant 6 s. Les ressources se créent en parallèle ; la durée totale n’a pas été chronométrée. Les durées varient beaucoup d’une exécution à l’autre (Ollama : 15 à 21 minutes) car elles dépendent surtout des téléchargements, qui se font en même temps.'));
c.push(H3('Échecs rencontrés pendant l’automatisation et corrections'));
c.push(...table(
  ['Date', 'Observation', 'Cause (établie ou supposée)', 'Correction et justification'],
  [
    ['18.10', 'Le modèle répondait « Je suis Qwen » et ignorait le prompt système, alors que `DEFAULT_MODEL_PARAMS` le contenait.', 'Établie par lecture du code d’Open WebUI v0.12.0 : le prompt système d’un modèle n’est appliqué (`utils/chat.py`) que s’il existe une entrée de modèle dans la base. Les variables d’environnement ne la créent pas.', '`scripts/webui-bootstrap.sh` crée ou met à jour l’entrée de modèle par l’API d’Open WebUI, en s’exécutant dans le pod (les identifiants administrateur y sont déjà dans l’environnement, donc aucun secret en argument). Le prompt a été retiré des variables d’environnement pour n’avoir qu’une source.'],
    ['18.10', 'Le contrôle 6 du test de fumée passait à tort.', 'Mauvaise clé lue (`name` au lieu de `tool`) et marqueur trop large.', 'Clé corrigée, marqueur strict (`OUTILS_APPELES` suivi d’un nombre ≥ 1), question moins ambiguë.'],
    ['18.10', 'Le script `garage-init.sh` affichait la clé secrète S3 (collée par erreur dans la conversation).', 'Ligne d’écho du script.', 'Sortie masquée. Principe retenu : aucun script n’affiche de secret, sauf `credentials.sh` qui est fait pour cela et se lance dans le terminal de l’utilisateur.'],
    ['19.10', '`tofu apply` : Open WebUI en échec, « context deadline exceeded », alors que le pod est devenu prêt ensuite.', 'Établie par les événements Kubernetes : le téléchargement de l’image (1,46 Go) a duré 12 min 44 s, contre un délai de 600 s. La lenteur vient probablement des autres téléchargements en parallèle (non mesuré). Une exécution précédente avait déjà pris 10 min 6 s.', 'Délai passé à une variable `webui_timeout_seconds` (1800 s par défaut), avec la mesure en justification. Réussi ensuite en 8 min 56 s.'],
    ['19.10', 'Contrôle 1 du test de fumée en échec juste après le déploiement : deux pods d’Alloy en `ContainerCreating`.', 'Contrôle instantané, alors que ces pods étaient encore en cours de création (cause du retard non vérifiée, probablement un téléchargement d’image).', 'Le contrôle réessaie pendant 5 minutes. Validé ensuite sur ce cluster : 6 contrôles sur 6.'],
    ['19.10', '`make local-webui-config` échoue avec « Connection refused » juste après la fin du déploiement.', 'Établie : le pod n’a aucune sonde de disponibilité (`readinessProbe` vide, relevé par `kubectl`), donc il est « prêt » dès que le conteneur tourne, alors qu’Open WebUI télécharge d’abord un modèle d’embedding (journaux). Cette fois Open WebUI se terminait en dernier (10 min 24 s), sans marge de temps.', 'Le script attend que `/health` réponde, jusqu’à 5 minutes. Ensuite : entrée de modèle créée, test de fumée 6 sur 6.'],
    ['19.10', 'Le fichier `secrets.auto.tfvars.json`, l’état OpenTofu et les clés S3 ont disparu après la mise à jour du dépôt.', 'Établie : le dossier était supprimé puis recréé à chaque nouveau zip, et ces fichiers, ignorés par git donc absents du zip, n’y sont pas.', '`credentials.sh` relit les mots de passe dans le cluster quand le fichier est absent (lecture du secret Grafana et de l’environnement du pod Open WebUI vérifiée). Procédure : extraire une mise à jour par-dessus le dossier existant. Conséquence : l’état OpenTofu d’un cluster peut être perdu ; pour un cluster local, on le reconstruit.'],
  ],
  [800, 2600, 3100, 3138]));
c.push(H3('Constats sans correction'));
c.push(B('**Redémarrages de Mimir au premier démarrage** (distributeur, ingesters, ruler : sortie en erreur après environ 1 s, puis stabilisation). Le journal d’un ingester contient « failed to create topics [mimir-ingest] … dial tcp … :9092: connection refused » : le composant Kafka du chart n’était pas encore prêt. Pour le distributeur, la cause n’a pas été vue ; l’hypothèse est la même. Aucune action : le système se stabilise seul.'));
c.push(B('**kubectl top indisponible** (« Metrics API not available ») : Kind n’installe pas de serveur de métriques. Les mesures de mémoire passent par Mimir.'));
c.push(B('**Open WebUI télécharge un modèle d’embedding depuis huggingface.co à chaque premier démarrage** (observé dans ses journaux, avec un avertissement sur les requêtes non authentifiées). Sur Switch Cloud, il faudra autoriser cet accès sortant ou précharger le modèle ; non traité.'));
c.push(H3('Décisions de l’automatisation et justifications'));
c.push(B('**Secrets générés aléatoirement** (`gen-secrets.sh`, droits 600, jamais écrasés, ignorés par git) plutôt que des mots de passe dans le dépôt ou saisis à la main. Jamais écrasés, car un nouveau mot de passe administrateur ne serait pas appliqué à un Open WebUI déjà initialisé. Limite constatée : le fichier n’est pas sauvegardé.'));
c.push(B('**Configuration d’Open WebUI en deux temps.** Par variables d’environnement du chart (compte administrateur, connexion à l’outil de l’assistant, modèle par défaut, désactivation des titres et suggestions) car ce sont des réglages d’initialisation ; par l’API pour l’entrée de modèle (prompt système), car les variables ne la créent pas (tableau ci-dessus). Limite lue dans le code et non contournée : ces variables ne servent qu’au premier démarrage (`PersistentConfig`) ; les changer plus tard n’a aucun effet sans supprimer le volume d’Open WebUI.'));
c.push(B('**Chart Helm local pour l’assistant** (`charts/assistant`) plutôt que des manifestes à la main : le même module sert en local et sur Switch Cloud, seuls le dépôt d’images, l’étiquette et les secrets de téléchargement changent (variables). En local l’image est construite sans cache (`--no-cache`, après un déploiement d’une image périmée) et chargée dans Kind ; pour Switch Cloud, `make switch-image` construit pour `linux/amd64` et la publie, mais l’architecture des nœuds SCK (amd64 ?) n’a pas été vérifiée.'));
c.push(B('**Ollama par le chart ollama (otwld) 1.88.0**, qui télécharge le modèle lui-même (`ollama.models.pull`, vérifié dans le chart par `make check-charts`) ; volume persistant de 30 Gi activé car le volume par défaut est temporaire (le modèle serait retéléchargé à chaque redémarrage) ; délai de 1800 s car le pod n’est prêt qu’après le téléchargement.'));
c.push(B('**Garage figé sur un commit git** (`ef6a03a…`) plutôt que sur la branche, pour qu’une reconstruction reproduise la même version ; il n’existe pas de dépôt Helm pour ce chart.'));
c.push(B('**make local-down supprime aussi l’état OpenTofu et les clés S3**, devenus faux une fois le cluster supprimé, mais conserve les secrets pour garder des identifiants stables d’une reconstruction à l’autre.'));
c.push(B('**think: false par défaut** pour la passe de recopie d’Open WebUI : section 4.11.'));
c.push(H3('Limites connues de l’automatisation'));
c.push(B('Les secrets (mot de passe Grafana, clés S3, mot de passe administrateur d’Open WebUI) se retrouvent en clair dans les valeurs Helm et dans le fichier d’état d’OpenTofu. Acceptable pour un cluster local jetable, pas pour la production.'));
c.push(B('L’assistant n’a ni authentification ni NetworkPolicy. L’entrée de modèle d’Open WebUI n’a pas de contrôle d’accès : un seul administrateur est prévu.'));
c.push(B('Le test de fumée vérifie qu’au moins un outil est appelé et qu’une réponse revient, pas que la réponse est utile (voir 4.11, où l’agent a renoncé deux fois de suite).'));
c.push(B('Le verrou des fournisseurs de `envs/local` (`.terraform.lock.hcl`, fournisseur Helm 2.17.0) est dans le dépôt depuis le 19.10 ; celui de `envs/switch` sera créé par `tofu init` au premier déploiement et devra y être ajouté.'));

// 4
c.push(H1('4. Step 3 : réalisation, décisions et justifications'));
c.push(P('Le Step 3 du professeur consiste à : construire une image avec FastAPI (endpoints renvoyant métriques et logs) et un agent IA (LangChain) ; récupérer un modèle LLM et le configurer avec Open WebUI et l’agent ; configurer Open WebUI avec le projet FastAPI via un « tool ». Le groupe a fixé trois contraintes : **confidentialité maximale** (données médicales), **assistant en lecture seule**, et **peu d’innovation** : on reprend les technologies de l’article du HUG cité dans le sujet (Ollama, LangChain/LangGraph, Open WebUI). **Ce Step 3 a été réalisé et testé en local sur Kind les 15 et 16 octobre 2026** : un membre du groupe exécutait les commandes, les sorties et captures d’écran m’ont été transmises. Le tableau suivant reprend toutes les décisions du projet, avec leur justification et un niveau de confiance ; les sections 4.1 à 4.9 donnent les détails et les mesures.'));
c.push(...table(['Décision', 'Choix retenu', 'Justification', 'Confiance'], dec, [1550, 1900, 4388, 1800]));

c.push(H2('4.1 État d’avancement au 16 octobre 2026'));
c.push(...table(
  ['Élément', 'État', 'Preuve'],
  [
    ['Ollama dans Kind, modèle `qwen3:8b`', 'Déployé, répond', '`ollama ps` : `qwen3:8b`, 6,7 Go, 100 % CPU, contexte 8192'],
    ['Assistant (FastAPI) version 0.4.3', 'Déployé ; endpoints répondent', 'Open WebUI lit `/tools/openapi.json` ; `/metrics/query` interrogé directement renvoie le top 5 mémoire ; code de la 0.4.1 vérifié dans le pod (`grep -c lisible app/units.py` = 4 pour la 0.4.1 ; `grep -c TRACE_RESULT_CHARS app/config.py` = 1 pour la 0.4.2). Le 17.10, la réponse de `/ask` au top 3 mémoire (6,69 GiB ; 679,6 MiB ; 393,6 MiB) est identique aux valeurs `lisible` relevées juste avant et juste après (même échantillon Mimir) ; un seul essai.'],
    ['Agent LangChain/LangGraph et 6 outils', 'Fonctionne, avec des défauts', 'Questions essayées : échecs de requêtes dans Mimir, top 3 mémoire, définition d’un pod (hors périmètre : l’outil n’est pas appelé). Défauts décrits en 4.4 et 4.6.'],
    ['Liaison avec Open WebUI', 'Fonctionne après deux réglages du modèle', '`POST /tools/ask 200 OK` dans les logs de l’assistant ; réponse affichée en français (section 4.5)'],
    ['Tests automatisés', '51 réussis (version 0.4.3)', 'Mimir, Loki et le modèle y sont simulés : ils ne prouvent rien sur le comportement réel de Mimir, Loki, Open WebUI ou qwen3'],
    ['Module OpenTofu', 'Étendu le 18.10.2026 : contient Ollama (téléchargement du modèle par le chart), l’assistant (chart local) et la configuration d’Open WebUI par variables d’environnement', 'Validé par `tofu validate` (OpenTofu 1.13.1, fournisseur Helm 2.17.0) mais jamais appliqué sur un cluster ; `manual/local/` reste la référence testée'],
    ['Comparaison avec `gpt-oss:20b`', 'Non faite', 'Voir 4.8'],
  ],
  [2700, 2300, 4638]));

c.push(H2('4.2 Fonctionnement réel'));
c.push(N2('L’utilisateur pose sa question dans Open WebUI, avec le modèle `qwen3:8b` et l’outil « Assistant Kubernetes » activé dans la conversation. Le prompt système du modèle (section 4.5) lui demande d’appeler l’outil, puis de recopier sa réponse.'));
c.push(N2('**Premier passage du modèle** (Ollama) : il choisit l’outil `ask_cluster_assistant` et lui passe la question. Open WebUI appelle `POST /tools/ask` depuis son backend, donc l’assistant reste interne au cluster.'));
c.push(N2('**L’agent de l’assistant** (LangGraph) fait appel au même modèle, qui choisit parmi six outils en lecture seule : requête PromQL instantanée, requête PromQL sur une période, valeurs d’un label de métriques, recensement des problèmes dans les logs d’un namespace, recherche dans les logs d’un namespace, valeurs d’un label de logs. Ils n’émettent que des requêtes GET vers Mimir et Loki.'));
c.push(N2('L’agent renvoie `answer` (la réponse), `tool_calls` (les requêtes utilisées) et `llm_calls` (durées et nombres de tokens de chaque appel au modèle).'));
c.push(N2('**Second passage d’Open WebUI** : le modèle relit le résultat de l’outil et le restitue à l’utilisateur.'));
c.push(P('Open WebUI affiche l’appel de l’outil `ask_cluster_assistant` et un lien « Voir le résultat » : en dépliant, on voit la question transmise, la réponse brute, la requête PromQL utilisée et les durées. C’est le moyen de vérifier ce que l’outil a réellement répondu, avant la reformulation du second passage.'));
c.push(note('obs', 'une question coûte au moins quatre appels au même modèle. Pour la question sur Mimir du 16.10.2026, `llm_calls` indique deux appels de l’agent (30,9 s et 6,4 s) ; Open WebUI en ajoute deux (choix de l’outil, puis relecture du résultat). Ce décompte est déduit du fonctionnement décrit ci-dessus, il n’a pas été recompté dans les logs d’Ollama.'));
c.push(note('doc', 'les serveurs d’outils OpenAPI globaux sont appelés depuis le backend d’Open WebUI (doc Open WebUI) ; `ChatOllama` et `bind_tools()` exigent un modèle qui supporte l’appel d’outils (doc LangChain).'));

c.push(H2('4.3 Ollama dans Kind : déploiement et mesures'));
c.push(P('Ollama est déployé **séparément** d’Open WebUI, dans le namespace `ollama` (chart `otwld/ollama` 1.88.0, Ollama 0.40.3, service `ollama.ollama.svc.cluster.local:11434`). Raison de conception : Open WebUI et l’agent de l’assistant utilisent le même serveur, donc un seul modèle est chargé en mémoire ; Open WebUI est relié par la clé `ollamaUrls` de son fichier de valeurs (`manual/local/open-webui.yaml`), le sous-chart Ollama d’Open WebUI étant désactivé. Le modèle `qwen3:8b` pèse 5,2 Go.'));
c.push(...table(
  ['Mesure', 'Valeur', 'Remarque'],
  [
    ['Génération', '9 à 12 tokens par seconde (15 et 16.10) ; 6,9 à 8,8 le 17.10', '`qwen3:8b`, CPU de la VM Docker (10 CPU). Le 17.10, `llm_calls` : 69 tokens en 7,8 s et 92 tokens en 13,4 s. Cause de l’écart non recherchée'],
    ['Lecture du prompt', '66 à 87 tokens par seconde', 'Exemple à froid : 1329 tokens en 20,1 s. Un prompt de 1436 tokens a été lu en 2,2 s. Les logs d’Ollama du 17.10 montrent le cache de prompt de llama.cpp activé : un prompt de 2667 tokens a réutilisé un préfixe de 1392 tokens (`lcp = 1392`, `f_sim = 0,997`). C’est cohérent avec les relectures rapides, sans prouver le cas à 2,2 s'],
    ['Chargement du modèle', '7,8 à 12,7 s à froid ; environ 0 s s’il est déjà chargé', 'Valeurs de `load_s` et de `ollama run --verbose`'],
    ['Déchargement', 'Environ 5 minutes après la dernière requête', '`ollama ps` affiche « UNTIL 4 minutes from now » juste après un usage'],
    ['Mémoire', '6,7 Go (`ollama ps`, contexte 8192) ; environ 6,6 Go de working set du pod', 'Relevé Mimir du 17.10 : 0,05 à 0,06 GiB quand le modèle est déchargé, 6,4 à 6,7 GiB (contexte 8192) une fois chargé. Avec un contexte de 4096, `ollama ps` indique 5,9 Go (17.10) contre 6,7 Go à 8192 : le contexte coûte environ 0,8 Go (deux relevés à des moments différents)'],
    ['Réflexion (« thinking ») activée', '339 tokens contre 113 pour une même consigne (explication en 100 mots)', 'Environ trois fois plus de tokens, donc de temps : l’agent la désactive (`reasoning=False`)'],
    ['Question posée à l’agent seul (`/ask`)', '11 à 68 s selon la question et l’état du modèle', 'Exemples : 30,9 s + 6,4 s (question Mimir, 16.10, dont 8,1 s de chargement) ; 10,4 s + 35,8 s (question mémoire, 16.10) ; 30,1 s + 37,5 s (top 3 mémoire, 17.10, sans chargement)'],
    ['Second passage d’Open WebUI', 'S’ajoute à l’agent : « Réflexion » affichée de 9 à 26 s', 'Le modèle y réfléchit (en anglais) avant de répondre en français'],
  ],
  [2400, 3500, 3738]));
c.push(note('obs', 'toutes les valeurs du tableau ont été relevées sur le Mac du membre du groupe (Docker Desktop, VM de 10 CPU et environ 15,6 GiB). Le modèle tourne sur CPU : Docker Desktop sur Mac n’a pas accès au GPU (section 4.8).'));
c.push(note('obs', 'relevé du 17.10.2026 : `helm list -A` indique `ollama` en révision 1 (chart `ollama-1.88.0`, application 0.40.3, installé le 15.10.2026 à 21:42) et `helm get values ollama -n ollama -o yaml` ne renvoie que `persistentVolume.enabled: true` et `persistentVolume.size: 30Gi`. Ces valeurs sont dans `manual/local/ollama.yaml`. Aucune valeur ne demande de télécharger un modèle : `qwen3:8b` a donc été tiré à part, par une commande non conservée.'));
c.push(...code(
`helm repo add otwld https://helm.otwld.com/
helm repo update
helm upgrade --install ollama otwld/ollama --version 1.88.0 \\
  --namespace ollama --create-namespace -f manual/local/ollama.yaml --wait --timeout 10m
kubectl exec -n ollama deploy/ollama -- ollama pull qwen3:8b`));
c.push(note('obs', 'relevé du 17.10.2026 : `helm repo list` contient `otwld` = `https://helm.otwld.com/` ; `kubectl get deploy -n ollama` montre le déploiement `ollama` (1/1) ; `ollama list` montre `qwen3:8b` (5,2 Go, ID 500a1f067a9f, téléchargé environ 45 heures plus tôt).'));
c.push(note('obs', 'la procédure manuelle ci-dessus est reconstruite : la commande qui a téléchargé le modèle n’a pas été conservée. L’installation d’Ollama a depuis été rejouée sur un cluster neuf par le module OpenTofu (chart `ollama` 1.88.0, paramètre `ollama.models.pull`), voir 3.7.'));

c.push(H2('4.4 L’assistant : FastAPI et agent LangGraph'));
c.push(P('L’image `assistant` (Python 3.13, FastAPI, LangChain/LangGraph, `langchain-ollama`) est construite en local et chargée dans Kind avec `kind load docker-image` : il n’y a pas de registre. Le déploiement se fait par `manual/local/assistant.yaml` (namespace `assistant`, service sur le port 8000).'));
c.push(...code(
`docker build --no-cache -t assistant:0.4.3 assistant/
kind load docker-image assistant:0.4.3 --name k8s-ai-monitoring
kubectl apply -f manual/local/assistant.yaml
kubectl rollout status deploy/assistant -n assistant
kubectl exec -n assistant deploy/assistant -- grep -c lisible app/units.py   # doit afficher un nombre > 0`));
c.push(note('obs', 'incident de déploiement antérieur : une version s’est retrouvée avec une image périmée. D’où `--no-cache` et la dernière commande, qui vérifie que le code en cours d’exécution est bien le nouveau.'));
c.push(...table(
  ['Endpoint', 'Rôle'],
  [
    ['`GET /health`', 'Sonde de disponibilité'],
    ['`GET /metrics/query`, `/metrics/range`, `/metrics/labels/{label}`', 'Requêtes PromQL instantanée et sur une période, valeurs d’un label (vers Mimir)'],
    ['`GET /logs/query`, `/logs/labels`, `/logs/labels/{label}`', 'Requête LogQL, labels et valeurs de labels (vers Loki)'],
    ['`GET /logs/problems`', 'Recense les problèmes des logs d’un namespace par une classification déterministe (section ci-dessous)'],
    ['`POST /ask`', 'Pose une question à l’agent'],
    ['`POST /tools/ask` (sous-application `/tools`)', 'Seul endpoint exposé à Open WebUI : sa spécification OpenAPI ne contient que `ask_cluster_assistant`, avec une description qui indique au modèle quand l’utiliser'],
  ],
  [4200, 5438]));
c.push(P('**Choix de conception et justifications.** Chaque choix répond à un défaut observé pendant les essais, pas à une hypothèse :'));
c.push(B('**Lecture seule par construction.** Les outils ne font que des GET vers Mimir et Loki ; aucun outil d’écriture n’existe, et l’API Kubernetes n’est pas utilisée. Deux tests le vérifient (`test_only_get_requests`, `test_no_write_tools`).'));
c.push(B('**Le jugement est déplacé du modèle vers le code.** `find_problems` classe les lignes de logs par catégories (`problems.py`) et renvoie des nombres et des exemples. Raison : Mimir journalise les requêtes en échec au niveau `info` (`status=failed`, `status_code=4xx`), et `qwen3:8b` sans réflexion les jugeait mal. Résultat sur Mimir (30 minutes, 16.10.2026) : 2 lignes examinées, aucune catégorie de problème ; ces 2 lignes portaient des compteurs à zéro. Les nombres sont des lignes de log, pas des requêtes distinctes : un même échec peut être journalisé par plusieurs composants.'));
c.push(B('**Outils bornés.** `search_logs` exige un namespace ; plage limitée à 24 h, 50 séries et 200 lignes (`config.py`) ; résultat d’outil tronqué à 3500 caractères. Raison : environ 3000 tokens de résultat lus ont coûté 35 à 44 s (mesure du 16.10.2026, reprise du commentaire du code) ; à 66–87 tokens lus par seconde, chaque millier de tokens coûte de l’ordre de 12 à 15 s et occupe la fenêtre de 8192 tokens.'));
c.push(B('**Contexte réel du cluster injecté dans le prompt** (labels et valeurs lus dans Mimir et Loki, mis en cache 300 s). Raison : sans cela, le modèle doit deviner la valeur du label `cluster` (`kind-local` ici) et les noms de namespaces, et `qwen3:8b` invente des requêtes quand il ne sait pas.'));
c.push(B('**Séries triées avant la coupure.** Au-delà de 50 séries, la plus élevée pouvait être écartée avant que l’agent ne la voie, ce qui fausse un « top N ». Le tri précède désormais la coupure (`test_series_sorted_before_cut`).'));
c.push(B('**Unités calculées en Python** (version 0.4.1, `app/units.py`) : un champ `lisible` (ex. `675,3 MiB`) est ajouté aux résultats en octets, et le prompt interdit au modèle de convertir lui-même. Raison : voir le constat n° 4 de la section 4.6. Unités binaires (MiB, GiB), comme `kubectl top`. Mimir ne renvoie pas l’unité : elle est déduite du nom de la métrique (`..._bytes`), et le champ est omis dès que la requête peut changer l’unité (`rate`, `count`, division…). C’est une heuristique.'));
c.push(B('**Traçabilité.** Chaque réponse contient les requêtes utilisées et le début du résultat reçu par l’agent (`tool_calls[].result`, 600 caractères par défaut, `TRACE_RESULT_CHARS`, 0 pour désactiver), et les durées (`llm_calls`). Le résultat a été ajouté en version 0.4.2 après le constat 6 de la section 4.6 : il permet de comparer ce que l’agent a vu à ce qu’il affiche. Coût : Open WebUI renvoie toute la réponse au modèle au second passage, donc ces caractères allongent ce passage ; l’effet n’est pas mesuré.'));
c.push(B('**Paramètres de l’agent** : température 0, réflexion désactivée, fenêtre de contexte 8192, au plus 6 étapes (limite de récursion 13).'));
c.push(note('obs', 'sur Kind : le top 5 mémoire est lu directement par `/metrics/query` ; le recensement des problèmes de Mimir répond (2 lignes examinées) ; une question de définition d’un pod n’appelle pas l’outil. Les premières versions de l’agent avec `qwen3:8b` inventaient des requêtes, répétaient une requête en échec et jugeaient mal les lignes `info` d’échec : c’est ce qui a motivé les garde-fous ci-dessus.'));
c.push(note('obs', 'version 0.4.2 déployée le 17.10 : `tool_calls[].result` apparaît dans la réponse et montre les valeurs brutes (octets) et `lisible` reçus par l’agent ; la réponse affichée par Open WebUI est identique à `answer`, lui-même identique à `lisible`. Deux appels au modèle : 29,8 s et 34,4 s. Coût mesuré dans les logs d’Ollama : le second passage d’Open WebUI lit 1367 tokens, contre 837 avec la 0.4.1 (+530 tokens, soit de l’ordre de 5 à 8 s de lecture à 66–87 tokens/s, estimation non mesurée directement).'));
c.push(note('notest', 'les 51 tests automatisés (Mimir, Loki et modèle simulés) ne prouvent rien sur le comportement réel de `qwen3:8b`. Les trois cas d’usage du sujet (santé globale du cluster, investigation d’incident, analyse de cause racine) n’ont pas été évalués de façon systématique.'));

c.push(H2('4.5 Liaison avec Open WebUI : configuration'));
c.push(N3('**Ajouter le serveur d’outils** dans les réglages d’administration d’Open WebUI (connexions de serveurs d’outils ; intitulés exacts des menus non notés). Type OpenAPI, URL `http://assistant.assistant.svc.cluster.local:8000/tools`, chemin de la spécification `openapi.json`, authentification « Aucun ». Le champ identifiant est resté vide : Open WebUI le nomme alors `server:0`.'));
c.push(N3('**Régler le modèle** `qwen3:8b` dans l’administration d’Open WebUI (menu exact non noté). Dans les capacités du modèle, **décocher « Outils intégrés »**. Dans ses paramètres avancés, mettre « Contexte num (Ollama) » sur « Sur mesure » avec la valeur **8192**. Dans son prompt système, coller le texte ci-dessous. Enregistrer.'));
c.push(N3('**Dans chaque conversation**, activer l’outil « Assistant Kubernetes » (le nom exact affiché n’a pas été noté) : les essais ont été faits ainsi.'));
c.push(...code(
`Tu es l’interface d’un assistant de supervision Kubernetes en lecture seule. Pour toute question sur l’état du cluster (métriques, logs, erreurs, pods), appelle l’outil ask_cluster_assistant avec la question de l’utilisateur. Ensuite, recopie le champ « answer » de l’outil tel quel, en français. N’ajoute aucune conclusion, aucune interprétation et aucune proposition. Si l’outil ne dit pas quelque chose, ne le dis pas.`));
c.push(note('obs', 'avec ces réglages, la question sur les requêtes échouées de Mimir (30 dernières minutes) appelle l’outil et affiche un texte identique au champ `answer` de `/ask` ; une question de définition d’un pod est traitée sans appeler l’outil ; la question sur la mémoire appelle l’outil. Avant les réglages (outils intégrés cochés, contexte non fixé), l’outil n’était jamais appelé.'));
c.push(note('code', 'dans Open WebUI v0.12.0, un modèle dont la capacité « Outils intégrés » est cochée reçoit en plus de nos outils tous les outils intégrés (`middleware.py`, `use_builtin_tools`) ; le réglage « Appel de fonction » ne passe en mode hérité que s’il vaut `legacy` : « Par défaut » est donc déjà le mode natif, « Natif » ne change rien ; la recherche d’outils différés est désactivée par défaut (`ENABLE_TOOL_SEARCH=False`) ; en exécutant la fonction de conversion d’Open WebUI sur la spécification de l’assistant, on obtient bien l’outil `ask_cluster_assistant`. Le code lu est celui du tag v0.12.0, version de l’image déployée.'));
c.push(note('notest', 'le prompt système s’applique à toutes les conversations avec `qwen3:8b`, pas seulement à la supervision. Il réduit le défaut de reformulation sans le supprimer de façon garantie : seuls quatre essais (trois questions différentes) ont été faits avec lui.'));
c.push(note('val', 'l’interrupteur « API Ollama » d’Open WebUI était désactivé au début des essais, et la cause n’a pas été établie. Open WebUI lançait aussi des générations supplémentaires (titre, suggestions, étiquettes) : elles ont été désactivées dans l’interface, les réglages exacts n’ont pas été notés.'));

c.push(H2('4.6 Constats de la session de test du 16 octobre 2026'));
c.push(...table(
  ['#', 'Constat', 'Cause', 'Décision', 'Statut'],
  [
    ['1', 'Open WebUI répond « je n’ai pas cet outil » alors qu’il est activé ; aucun `POST /tools/ask` ne parvient à l’assistant.', 'Établie : Open WebUI envoie 40 outils (39 intégrés + le nôtre) ; le prompt fait environ 5 640 tokens et Ollama le ramène à 2050 (log : `truncating input prompt limit=2050 prompt=5623` puis `5640` deux fois). D’après le code, notre outil est le premier de la liste ; que ce soit lui qui soit perdu est une déduction cohérente avec le comportement observé.', 'Décocher « Outils intégrés » pour `qwen3:8b` : le premier prompt tombe à 222 tokens.', 'Résolu (observé)'],
    ['2', '**CADUC (Switch abandonné le 22.10.2026)** : La fenêtre de contexte d’Ollama est d’environ 2048 tokens (limite 2050 dans le log).', 'Non expliquée : la doc annonce 4096 par défaut et `ollama run` affiche 4096 ; Open WebUI ne fixe pas de `num_ctx` dans son code.', 'Fixer 8192 explicitement pour le modèle, comme l’agent.', 'Appliqué ; l’écart avec la doc reste à comprendre'],
    ['3', '**CADUC (Switch abandonné le 22.10.2026)** : La reformulation par Open WebUI ajoute des conclusions non fondées (« toutes passées avec succès », « fonctionnement normal »).', 'Établie : ces phrases viennent du second passage d’Open WebUI (le modèle les ajoute après l’outil). La réponse brute de l’agent est, elle, un peu large (« absence d’erreurs ou d’échecs » alors que 2 lignes seulement ont été examinées).', 'Prompt système de recopie (4.5).', 'Atténué sur 4 essais (3 questions différentes) ; garantie non démontrée'],
    ['4', 'Valeurs de mémoire fausses d’un facteur 10 : open-webui « 7,11 GB » et grafana « 4,07 GB ».', 'Relevé direct par `/metrics/query` quelques minutes plus tard : 708 096 000 octets (675,3 MiB, soit 0,71 Go) et 483 201 024 octets (460,8 MiB, soit 0,48 Go). Les valeurs affichées étaient environ dix fois trop grandes. L’erreur apparaît déjà dans le résultat dépliable de l’outil, donc dans la conversion faite par le modèle de l’agent, pas dans la recopie par Open WebUI. Les relevés ne sont pas simultanés : l’écart exact n’est pas établi.', 'Conversion en Python (champ `lisible`, version 0.4.1).', 'Corrigé et vérifié le 17.10 : la réponse de `/ask` est identique aux valeurs `lisible` relevées juste avant et juste après (un seul essai)'],
    ['5', 'Le réglage « Appel de fonction » sur « Natif » semblait devoir aider.', 'Dans le code, « Par défaut » est déjà le mode natif.', 'Aucune action.', 'Sans effet'],
    ['6', 'Le 17.10, Open WebUI affiche ollama à 3,09 GiB ; un relevé direct une minute plus tard donne 6,70 GiB.', 'Établie : les deux valeurs sont justes. Une requête sur période dans Mimir donne pour le pod ollama 0,06 GiB jusqu’à 19:41, puis 3,09 GiB à 19:42 (la valeur affichée), 6,42 GiB à 19:43 et 6,70 GiB à 19:44. L’agent a donc interrogé Mimir pendant le chargement du modèle, déchargé depuis plusieurs minutes (log d’Ollama : chargement à 19:41:08). Ma première hypothèse (rechargement après un changement de contexte) était fausse : le modèle n’était plus en mémoire.', 'Aucune correction du code : la valeur est exacte à l’instant de la requête. À savoir : la première question après une pause voit une mémoire partielle et paie le chargement.', 'Résolu (observé)'],
    ['7', 'Le 17.10 à 22:16, le top 3 mémoire (open-webui-0 691,9 MiB, grafana 465,6 MiB, kube-apiserver 340,0 MiB) ne contient pas ollama, dont le modèle venait d’être sollicité.', 'Établi : `result` (version 0.4.2) montre les valeurs brutes (725 491 712 ; 488 189 952 ; 356 524 032 octets) et `lisible` ; mes divisions donnent 691,9 ; 465,6 ; 340,0 MiB, identiques à la réponse. Une requête sur période (pas de 30 s) donne pour ollama 0,05 GiB jusqu’à 22:16:30 puis 6,39 GiB à 22:17:00 ; la requête de l’agent date de 22:16:44. Mimir n’avait donc pas encore d’échantillon élevé : le classement reflète le dernier échantillon connu. La mémoire réelle à 22:16:44 n’est pas mesurable avec ces données.', 'Aucune correction du code. Limite à connaître : une requête instantanée donne le dernier échantillon de Mimir (retard de l’ordre de la minute), pas l’instant exact de la question.', 'Établi (retard d’échantillonnage)'],
  ],
  [400, 2500, 3300, 2000, 1438]));

c.push(H2('4.7 Sécurité et confidentialité'));
[
 'Les données restent dans le cluster : aucun appel à une API de LLM externe n’est configuré (`enableOpenaiApi: false`, Ollama local), et l’hébergement cible est chez Switch (fournisseur suisse). **Le trafic sortant du cluster n’a pas été observé** : l’absence d’appel externe n’est pas vérifiée.',
 'Lecture seule : requêtes HTTP GET vers Mimir et Loki uniquement, pas d’accès à l’API Kubernetes (vérifié par des tests).',
 'Open WebUI est authentifié (premier compte = administrateur). **L’assistant, lui, n’a aucune authentification** : tout pod du cluster peut appeler `assistant.assistant.svc.cluster.local:8000` et lire des extraits de logs. Acceptable pour un prototype local ; à traiter avant tout usage réel (jeton ou NetworkPolicy).',
 'Open WebUI conserve l’historique des conversations sur son volume (2 Gi) : les extraits de logs affichés y sont donc conservés.',
 '**Le niveau de log DEBUG d’Open WebUI** (`GLOBAL_LOG_LEVEL=DEBUG`, activé par `kubectl set env` pour le diagnostic du 16.10) écrit les requêtes complètes envoyées au modèle, donc le contenu des échanges. Il est temporaire : à remettre par `kubectl set env statefulset/open-webui -n open-webui GLOBAL_LOG_LEVEL-`, ce qui redémarre le pod (le port-forward est à relancer). Ce réglage n’est pas dans le fichier de valeurs Helm : un `helm upgrade` l’effacerait aussi.',
 'Les logs peuvent contenir des données sensibles : namespaces autorisés et taille des résultats limitée sont en place ; le masquage de motifs sensibles avant envoi au modèle n’est pas conçu.',
 'L’état OpenTofu contient les secrets : ne pas le versionner (déjà dans `.gitignore`).',
 'NetworkPolicies : le CNI par défaut de Kind pourrait ne pas les appliquer (à vérifier).',
].forEach((t) => c.push(B(t)));

c.push(H2('4.8 Matériel pour le LLM'));
c.push(P('Le cluster Kind n’a pas de GPU. Docker Desktop sur Mac n’a pas accès au GPU (FAQ Ollama : « GPU acceleration is not available for Docker Desktop in macOS due to the lack of GPU passthrough and emulation ») : le modèle tourne sur CPU, à 9 à 12 tokens par seconde (section 4.3). Pour profiter du GPU du Mac, il faudrait lancer Ollama directement sur macOS, hors Docker : **non testé**. La doc Switch Cloud liste des flavors GPU (`gpu-1xL40S.d.c040r345`, `gpu-2xL40S.d.c080r690`, `gpu-2xH100NVL.d.c040r500`) et précise que les quotas doivent être ajustés au préalable ; leur utilisation dans un cluster SCK n’est pas vérifiée. Registre d’images : avec Kind, `kind load docker-image <image>` ; pour SCK, un registre accessible depuis le cluster reste à choisir.'));
c.push(P('**Contexte.** La doc Ollama lue indique 4096 tokens par défaut (`OLLAMA_CONTEXT_LENGTH`) : un modèle lancé par `ollama run` sans réglage affiche bien 4096 dans `ollama ps` (17.10). Pourtant les logs d’Ollama du 16.10 montrent une limite de 2050 tokens pour les requêtes d’Open WebUI (section 4.6, constat 2) ; le code d’Open WebUI v0.12.0 ne fixe pas de `num_ctx` par défaut, l’origine de cette limite reste inexpliquée. Ce contexte limite ce que l’agent peut lire : environ 1300 à 1400 tokens pour les prompts de l’agent relevés. La fenêtre de 8192 tokens est fixée explicitement pour le modèle dans Open WebUI et pour l’agent ; son coût en mémoire est d’environ 0,8 Go (6,7 Go à 8192 contre 5,9 Go à 4096, relevés `ollama ps`).'));
c.push(P('**Autre modèle.** La comparaison avec `gpt-oss:20b`, demandée par le sujet (« quel LLM local offre le meilleur compromis »), n’a pas été faite. Ce modèle pèse environ 14 Go : il ne devrait pas tenir dans la VM Docker (environ 15,6 GiB au total, à partager avec toute la stack), mais cela n’a pas été essayé. Il faudrait Ollama sur macOS ou une VM plus grande.'));
c.push(note('obs', 'l’appel d’outils de `qwen3:8b` est observé fonctionnel dans l’agent (LangChain, `bind_tools`) et dans Open WebUI (mode natif), à condition des réglages de la section 4.5. Sa fiabilité sur des questions libres reste limitée (section 4.4).'));
c.push(note('val', 'qualité des réponses de `gpt-oss:20b` face à `qwen3:8b`, et vitesse avec un GPU : à mesurer.'));

c.push(H2('4.9 Limites connues'));
[
 '**Latence** : 11 à 68 s pour l’agent seul, plus 9 à 26 s de « Réflexion » au second passage d’Open WebUI ; le modèle est déchargé environ 5 minutes après la dernière requête (8 à 13 s de chargement). La réflexion du second passage a été désactivée le 19.10 (`think: false`, section 4.11). Piste non essayée : prolonger le maintien en mémoire d’Ollama.',
 '**Fidélité** : le modèle peut encore ajouter des affirmations lors de la reformulation. Il faut déplier « Voir le résultat » pour comparer avec la réponse de l’outil.',
 '**L’absence de ligne d’erreur n’est pas l’absence de panne.** Le recensement des problèmes lit les logs d’un namespace, pas les métriques ; son filtre et sa classification (`LOKI_FILTER`, `problems.py`) reposent sur les formats de logs observés (Mimir, Loki, Garage, kube-system) : un échec journalisé autrement peut passer inaperçu.',
 '**Variabilité du modèle** : `qwen3:8b` peut choisir un mauvais outil ou inventer une requête. Les garde-fous la bornent, ils ne l’éliminent pas, et aucune mesure systématique n’existe encore.',
 '**Étapes inutiles de l’agent** : pour un classement, `qwen3:8b` appelait d’abord `metric_label_values` (le prompt disait d’interroger les labels en cas de doute), ce qui ajoutait environ 1200 tokens de lecture. La règle de prompt de la version 0.4.3 l’a supprimée : voir la mesure en 4.10.',
 '**Ressources de l’assistant** : demande 50m de CPU et 128 Mi, limite 512 Mi de mémoire. Ces valeurs sont des estimations non vérifiées (`kubectl top pod -n assistant`).',
 '**Pas d’authentification sur l’assistant** (section 4.7).',
].forEach((t) => c.push(B(t)));

c.push(H2('4.10 Banc d’essai : version 0.4.2 contre 0.4.3 (18 octobre 2026)'));
c.push(P('**Objectif.** Savoir si la règle de prompt de la version 0.4.3 (n’appeler `metric_label_values` / `log_label_values` que pour retrouver un nom absent du contexte, jamais pour un classement ou une agrégation) apporte un gain significatif. Le script `scripts/bench_ask.py` pose cinq questions à `/ask` dans le pod, après une question de chauffe non comptée, et relève pour chacune la durée, le nombre d’appels au modèle, les tokens lus, les outils choisis et un extrait de réponse. Il se lance depuis le dossier du dépôt : `kubectl exec -i -n assistant deploy/assistant -- python - < scripts/bench_ask.py`.'));
c.push(P('**Critère fixé avant la mesure de la 0.4.3.** Le critère initial (20 % de tokens et d’appels en moins sur le total) a été corrigé avant l’essai, car la mesure de référence montrait que la règle ne cible que la question 1 : sur le total, le gain attendu était d’environ 6 %. Critère retenu : tokens de la question 1 en baisse d’au moins 20 % ; aucune autre question en hausse de plus de 5 % ; aucune réponse devenue fausse. Sinon, arrêt du réglage de l’agent en local.'));
c.push(...table(
  ['Question', '0.4.2, passage 1', '0.4.2, passage 2', '0.4.3, passages 1 / 2', 'Tokens, 0.4.3 / moyenne 0.4.2'],
  [
    ['1. Top 3 mémoire', '38,5 s ; 2 appels ; 3997', '34,1 s ; 2 appels ; 3999', '16,5 / 15,2 s ; 2 appels ; 3184 / 3181', '−20,4 %'],
    ['2. Namespace le plus gourmand', '33,8 s ; 4 appels ; 6663 (échec)', '33,4 s ; 4 appels ; 6663 (échec)', '8,5 / 8,1 s ; 2 appels ; 3036 / 3037 (réponses)', '−54,4 %'],
    ['3. Cibles up', '5,5 s ; 2 ; 2869', '5,0 s ; 2 ; 2869', '4,8 / 4,9 s ; 2 ; 2982 / 2979', '+3,9 %'],
    ['4. Mémoire du pod grafana', '10,4 s ; 2 ; 2940', '8,9 s ; 2 ; 2939', '9,1 / 9,2 s ; 2 ; 3049 / 3049', '+3,7 %'],
    ['5. Requêtes échouées dans Mimir', '39,7 s ; 2 ; 4436', '37,7 s ; 2 ; 4437', '42,5 / 44,0 s ; 2 ; 4551 / 4551', '+2,6 %'],
    ['**Total**', '127,9 s ; 12 ; 20 905', '119,1 s ; 12 ; 20 907', '81,4 / 81,4 s ; 10 ; 16 802 / 16 797', '−19,6 %'],
  ],
  [2300, 1850, 1850, 1850, 1788]));
c.push(note('obs', 'les deux passages sur la 0.4.2 sont presque identiques en tokens (20 905 et 20 907) et en appels (12) : à température 0, le chemin du modèle est reproductible ; les durées varient d’environ 7 %. Sur la 0.4.3 (deux passages, reproductibles : 16 802 et 16 797 tokens, 10 appels), la question 1 passe de 3998 à 3182 tokens en moyenne (−20,4 %, le seuil était de 20 % : marge faible) ; les questions 3, 4 et 5 augmentent de 2,6 à 3,9 % (le prompt est plus long d’environ 110 tokens) ; la question 2, qui échouait de façon reproductible, reçoit une réponse. Le critère est rempli, mais la question 1 le remplit de justesse.'));
c.push(note('obs', 'cause de l’échec de la question 2 sur la 0.4.2 : le modèle convertissait les octets en Go dans la requête PromQL (division par 1024, visible dans l’URL de la requête dans le log de la gateway Mimir), contre la consigne du prompt, avec des parenthèses non équilibrées ; Mimir répondait 400, trois fois de suite, puis l’agent renonçait en le disant. Avec la 0.4.3, le modèle écrit directement `topk(1, sum by (namespace) (...))`. La règle de prompt n’était pas faite pour cela : l’attribution est faite par exclusion (seul le prompt a changé, la référence est reproductible) ; la réponse existe aux deux passages de la 0.4.3.'));
c.push(note('obs', 'effet de l’observateur : les requêtes mal formées de l’agent apparaissent dans les logs de Mimir comme des requêtes en échec (code 400, `user_agent=python-httpx`). `find_problems` en comptait 6 lignes après un passage de la question 2 et 12 après deux ; ce sont 3 requêtes par passage, chacune journalisée par la gateway et par le query-frontend. Avec la 0.4.3, la réponse à la question 5 parle de « 12 lignes de requêtes en échec » et non de requêtes, et cite la requête mal formée ; ces lignes viennent des passages précédents sur la 0.4.2.'));
c.push(note('obs', 'la réponse à la question 2 dépend de l’état du modèle. Au premier passage : « ollama, 6,32 GiB ». Au second : « mimir, 1,10 GiB », alors que le relevé direct donne ollama 6,33 GiB, mimir 1,09 GiB, monitoring 702,3 MiB, open-webui 690,1 MiB, kube-system 653,4 MiB. Au second passage, ollama est aussi absent du top 3 des pods (question 1). Hypothèse cohérente avec le constat 7 (4.6) : le modèle venait d’être déchargé puis rechargé par la question de chauffe, et le dernier échantillon de Mimir précédait le chargement. Non vérifié (pas de requête sur période pour cette heure). Conséquence : l’agent répond fidèlement au dernier échantillon, mais poser une question à l’assistant charge le modèle et modifie ce qu’on mesure.'));
c.push(note('notest', 'la réponse complète à la question 5 n’a pas été lue : le script en tronque l’affichage à 300 caractères. Les questions 1 et 4 sont cohérentes entre elles à chaque passage (grafana : 379,3 MiB au premier, 569,8 MiB au second), mais la valeur de grafana varie d’un passage à l’autre (369,5 ; 374,0 ; 379,3 ; 569,8 ; 655,1 MiB observés le 18.10) pour une cause non établie. `count(up)` = 11 a été confirmé par un relevé direct.'));
c.push(note('obs', 'le pod grafana n’a qu’un conteneur (`grafana`, 374,0 MiB au relevé direct) : mon hypothèse d’un sidecar, qui aurait expliqué les 655,1 MiB vus au premier passage, était fausse. Ce chiffre était probablement un pic ; non vérifié.'));

c.push(H2('4.11 Désactiver la réflexion de la passe de recopie : think: false (19 octobre 2026)'));
c.push(P('**Question.** Après l’appel de l’outil, Open WebUI refait un passage du modèle pour reformuler la réponse. Ce passage affichait une « Réflexion » de 13 à 35 s alors qu’il ne fait que recopier le champ `answer`. Désactiver cette réflexion fait-il gagner du temps sans dégrader la recopie ? **Réglage essayé :** paramètre `think: false` dans l’entrée de modèle d’Open WebUI (transmis à Ollama, lu dans le code d’Open WebUI). L’agent n’est pas concerné : il appelle Ollama lui-même, à température 0, et sa réflexion était déjà désactivée.'));
c.push(...table(
  ['Mesure', 'Avant (réflexion active)', 'Après (`think: false`)'],
  [
    ['Réflexion affichée', '14 s, 33 s, 23 s', 'Aucune'],
    ['Génération de la passe de recopie (journaux Ollama)', '215 tokens en 24,7 s ; 375 tokens en 43,5 s ; 287 tokens en 33,1 s', '89 tokens en 7,9 s'],
    ['Durée totale, chronomètre', '57,6 s et 36,6 s (mais sans appel d’outil, voir ci-dessous)', '93 s (démarrage à froid), 41,3 s, 37,4 s, avec appel d’outil'],
    ['Appel de l’outil', 'Une fois sur trois dans une même conversation', 'À chaque fois dans des conversations séparées ; rappelé aussi à la seconde question d’une même conversation'],
    ['Texte final', 'Fidèle au champ `answer`', 'Fidèle au champ `answer` (3 sur 3, plus les 2 essais ci-dessous)'],
  ],
  [2600, 3519, 3519]));
c.push(note('obs', 'valeur relue dans Open WebUI par l’API : `think = False`, `num_ctx = 8192`. Après réglage, « Bonjour, qui es-tu ? » reçoit une réponse correcte (assistant de supervision Kubernetes en lecture seule), sans réflexion ni appel d’outil.'));
c.push(note('obs', 'sur la passe de recopie, la réflexion supprimée représentait environ 17 s de génération (24,7 s contre 7,9 s) ; la durée totale reste dominée par l’agent (environ 20 s pour la requête 3 sur 37,4 s).'));
c.push(note('notest', 'la comparaison est indicative : une seule exécution par condition, trois mesures après. Je n’ai pas de chronomètre « avant » pour une conversation neuve avec appel d’outil : les 57,6 s et 36,6 s « avant » portent sur des requêtes sans appel d’outil dans une conversation déjà ouverte. Les nombres de tokens de prompt ne se comparent pas (Ollama ne compte que les tokens non mis en cache). Les 93 s de la première requête incluent un démarrage à froid dont la décomposition n’a pas été mesurée.'));
c.push(P('**Constat annexe : une question répétée dans la même conversation n’appelait pas toujours l’outil.** Avec la réflexion active, aux deuxième et troisième questions identiques, le modèle a recopié sa réponse précédente sans rappeler l’outil (valeurs identiques, aucun appel visible, et son raisonnement l’annonce). Pour une supervision, c’est un risque de chiffres périmés. Avec `think: false`, l’outil a été rappelé aux deux essais, ce qui ne permet pas de conclure (un seul essai).'));
c.push(P('**Limite de l’agent mise en évidence.** Aux deux essais d’une même conversation, l’agent a produit deux fois la même requête PromQL aux parenthèses non équilibrées (`… / 1024 / 1024` sans parenthèse fermante), a reçu l’erreur 400 de Mimir, puis a renoncé avec une réponse qui n’en est pas une (« La requête PromQL semble avoir un problème de syntaxe »), relayée fidèlement. Sur les six exécutions avec appel d’outil de ces séries de mesure, deux se terminent ainsi, deux se corrigent après une erreur 400 et deux réussissent du premier coup : trop peu pour donner un taux. Aucun lien avec `think` (l’agent ne lit pas ce paramètre). L’agent est figé en 0.4.3. Le prompt de l’agent contient un contexte du cluster calculé à chaque démarrage (`cluster_context()`), ce qui peut faire varier sa taille (1461 puis 1453 tokens) et, à température 0, ses requêtes ; non vérifié.'));
c.push(P('**Décision.** `think: false` est la valeur par défaut de `scripts/webui-bootstrap.sh` (`WEBUI_THINK=default` pour ne pas la fixer, `true` pour l’activer). Justification : gain de génération mesuré sur la passe de recopie, recopie toujours fidèle sur les essais, aucune dégradation observée de l’appel d’outil ni de l’identité du modèle. À rouvrir si une série de questions plus large montre une dégradation.'));

c.push(H2('4.12 Assistant 0.5.0 : Amazon Bedrock et interface compatible OpenAI (22 octobre 2026)'));
c.push(P('Le retour du professeur du 22.10.2026 (chapitre 6) remplace Ollama par un modèle public pour le déploiement cloud. L’assistant a donc été modifié de façon **additive** : le comportement local est inchangé (`LLM_PROVIDER=ollama` par défaut, et le module OpenTofu continue de déployer l’image 0.4.3). Changements du commit `f242ee1` (branche `dev/nicolas`) :'));
c.push(B('**Fournisseur du modèle** : variable `LLM_PROVIDER` (`ollama` ou `bedrock`). Avec `bedrock`, l’agent utilise `ChatBedrockConverse` (bibliothèque `langchain-aws` 1.9.0, épinglée ; son installation a été vérifiée sans modifier les versions déjà figées). Modèle par défaut `mistral.mistral-large-3-675b-instruct`, région `us-east-1`, température 0, plafond de génération de 600 tokens par appel (valeur choisie, non mesurée : la consigne demande 120 mots au plus). Aucune clé dans le code ni dans l’image : le SDK AWS cherche lui-même les identifiants (rôle de l’instance, ou variables d’environnement en développement).'));
c.push(B('**Interface compatible OpenAI** : `GET /v1/models` et `POST /v1/chat/completions`, avec ou sans flux. Open WebUI voit l’assistant comme un modèle et lui envoie la conversation ; seuls les tours « user » et « assistant » sont transmis à l’agent (le prompt système est celui de l’agent). Le flux est émis en un seul bloc : l’agent n’émet pas de jetons au fil de l’eau, mais Open WebUI demande du flux.'));
c.push(B('**Règle de périmètre dans le prompt système** : l’assistant ne traite que la supervision du cluster ; pour toute autre question (météo, culture générale, etc.), il répond en une phrase qu’il y est limité, sans appeler d’outil ; il peut répondre à une salutation. Elle répond à la question de test proposée par le professeur (« Quel temps fait-il aujourd’hui ? »).'));
c.push(B('**Statistiques et texte** : `llm_stats` lit aussi les métadonnées d’usage de Bedrock (tokens, latence) ; le texte des réponses est normalisé (`text_of`), car Bedrock renvoie une liste de blocs.'));
c.push(note('code', '58 tests automatisés (51 existants et 7 nouveaux), exécutés dans l’environnement de rédaction avec des faux modèles : sélection du fournisseur, statistiques, normalisation du texte, historique de conversation, interface `/v1` (réponse simple, flux, rejet d’une conversation sans tour utilisateur). Ils ne disent rien du comportement réel de Mistral Large 3.'));
c.push(note('aws', 'image `assistant:0.5.0` construite sur le Mac du groupe (40,6 s, architecture arm64). Premier lancement sans identifiants : `/v1/chat/completions` renvoie « NoCredentialsError » (chemin d’erreur prévu, HTTP 502). Second lancement avec les identifiants du CLI AWS passés par variables d’environnement : la question « Quel temps fait-il aujourd hui ? » est refusée en un seul appel au modèle (« Je suis limité à la supervision du cluster Kubernetes et ne peux pas répondre à cette question. »), avec 1 593 tokens en entrée et 19 en sortie, soit environ 0,0008 $ aux prix de Mistral Large 3 (1 593 × 0,50 + 19 × 1,50, par million). **Un seul essai, une seule formulation.** Le cluster n’était pas joignable (Kind supprimé) : le contexte du cluster était donc absent du prompt, plus court qu’en usage réel.'));
c.push(P('**Pourquoi l’interface `/v1`.** D’après la documentation d’Open WebUI, il ne se connecte pas directement à Bedrock : il passe par un proxy fourni par AWS, le *Bedrock Access Gateway*. Cela ajouterait un composant à déployer, ce que le choix de Bedrock devait justement éviter. En exposant `/v1`, seul l’assistant parle à Bedrock. Conséquence attendue, **non mesurée** : un enchaînement d’appels au LLM par question au lieu de deux (aujourd’hui le modèle d’Open WebUI appelle l’outil, puis l’agent appelle son propre modèle), et un refus hors sujet traité par l’agent plutôt que par un modèle intermédiaire.'));
c.push(H3('Limites'));
c.push(B('L’interface `/v1` n’a pas d’authentification : elle ne doit être joignable que depuis l’hôte d’Open WebUI.'));
c.push(B('Non testés : une vraie question d’exploitation avec Bedrock (aucun cluster à interroger lors du test), la fiabilité des requêtes PromQL de Mistral Large 3 (le défaut de parenthèses observé avec `qwen3:8b` en 4.11 peut ou non se reproduire), le comportement via Open WebUI, le refus sur d’autres formulations hors sujet.'));
c.push(B('La consommation réelle de tokens par question avec outils reste à mesurer : l’estimation de 4 000 à 8 000 tokens par question, donnée avant ce test, n’était pas mesurée.'));

// 5 points ouverts
c.push(H1('5. Points ouverts et vérifications à faire'));
c.push(...table(
  ['#', 'Point', 'Comment le lever'],
  [
    ['1', 'Que veut dire « Mimir sans MinIO » pour le professeur ? Le chart exige un S3 sans MinIO.', 'Question au professeur. Garage en local ; sur AWS, Amazon S3 remplace SCS3 (22.10.2026), la question ne se pose plus pour le cloud.'],
    ['2', 'Endpoint, région, clés et unicité des noms de buckets SCS3.', 'Pages SCS3 « User Authentication » et « Create an S3 Bucket », ou portail.'],
    ['3', 'Votre projet a-t-il accès à SCK et SCS3 ? Quotas et coûts ?', 'Portail Switch Cloud / support.'],
    ['4', 'La collecte s’interrompt-elle quand le Mac passe en veille ? (creux observés dans `count(up)`, cause non vérifiée)', 'Mettre le Mac en veille volontairement, puis observer `count(up)` et les redémarrages de pods.'],
    ['5', 'Métriques de nœud : node-exporter n’est pas déployé. Faut-il l’ajouter (CPU et mémoire des nœuds) ?', 'Décision du groupe ; features `clusterMetrics` / `hostMetrics` du chart.'],
    ['6', 'Format de sortie de `garage key create` attendu par `garage-init.sh`. **Levé** : script exécuté avec succès sur un cluster neuf (18 et 19.10).', 'Rien à faire en local ; à refaire en lecture seule pour SCS3.'],
    ['7', 'Provider Helm 3.x (syntaxe différente) et formules Homebrew.', 'Doc du provider ; `brew search`.'],
    ['8', '**CADUC (Switch abandonné le 22.10.2026)** : Création du cluster SCK en automatique (JSON, presets, kubeconfig).', 'Pages Switch « KKP API » et « Manage a Cluster ».'],
    ['9', 'Step 3 : `qwen3:8b` et appel d’outils. **Levé en partie** : fonctionne dans l’agent et dans Open WebUI avec les réglages de 4.5 ; fiabilité sur des questions libres non mesurée ; vitesse mesurée (9 à 12 tokens/s).', 'Série de questions de test systématique (cas d’usage du sujet) avec résultats consignés.'],
    ['10', '**CADUC (Switch abandonné le 22.10.2026)** : Step 3 : GPU Switch utilisable dans SCK ? Quotas ?', 'Support Switch Cloud.'],
    ['11', 'Step 3 : registre d’images pour l’image de l’assistant en cloud. Voir le point 33.', 'Décidé le 25.10.2026 : registre GitLab.'],
    ['12', 'Fenêtre de contexte d’Ollama : limite de 2050 tokens observée alors que la doc annonce 4096 par défaut.', 'Comprendre pourquoi les requêtes d’Open WebUI étaient limitées à 2050 (logs de démarrage d’Ollama, variables d’environnement du pod).'],
    ['13', 'Comparaison `qwen3:8b` / `gpt-oss:20b` demandée par le sujet : non faite (14 Go ne tiennent probablement pas dans la VM Docker).', 'Ollama installé sur macOS (GPU) ou VM Docker plus grande ; mêmes questions de test.'],
    ['14', 'Version 0.4.1 : unités vérifiées le 17.10 sur une question (réponse identique au relevé direct) ; autres requêtes en octets et autres questions non essayées ; prompt de recopie essayé sur 4 essais seulement (3 questions différentes). L’écart sur ollama (3,09 GiB affiché, 6,70 GiB une minute plus tard) est expliqué : chargement du modèle en cours (voir 4.6, constat 6).', 'Autres questions de test (cas d’usage du sujet).'],
    ['15', 'Niveau de log DEBUG d’Open WebUI encore actif. Les réglages du modèle (outils intégrés, contexte, prompt, think) sont stockés dans le volume d’Open WebUI ; ils sont désormais réappliqués par `webui-bootstrap.sh`, mais les variables d’environnement du chart ne servent qu’au premier démarrage.', 'Commande de retour en 4.7 ; ne pas modifier ces variables sur un Open WebUI déjà initialisé sans supprimer son volume.'],
    ['16', '**Levé en local** : le module OpenTofu déploie Ollama (le chart télécharge le modèle) et l’assistant sur un cluster neuf (19.10, section 3.7). Reste : une exécution d’un seul tenant sans intervention avec toutes les corrections (en cours).', 'Consigner le résultat de cette exécution.'],
    ['17', 'Assistant sans authentification ; limite mémoire de 512 Mi estimée.', 'NetworkPolicy ou jeton ; `kubectl top pod -n assistant`.'],
    ['18', 'Pourquoi l’interrupteur « API Ollama » d’Open WebUI était-il désactivé au départ ?', 'Non expliqué ; à observer lors d’une réinstallation.'],
    ['19', 'Interprétation de « Mimir sans MinIO » : voir le point 1 (toujours à confirmer).', 'Question au professeur.'],
    ['20', 'Accès sortant vers `huggingface.co` : Open WebUI télécharge un modèle d’embedding à son premier démarrage. Sur AWS, l’instance EC2 devra pouvoir sortir (non vérifié).', 'À vérifier au premier démarrage d’Open WebUI sur l’instance.'],
    ['21', '**CADUC (Switch abandonné le 22.10.2026)** : Architecture des nœuds SCK (amd64 ?) et registre d’images pour `make switch-image` (construction `linux/amd64`).', 'Doc Switch « Flavors » / portail ; choix du registre (point 11).'],
    ['22', 'Fichiers locaux non versionnés (secrets, état OpenTofu, clés S3, verrou des fournisseurs) : perdus si le dossier est recréé.', 'Extraire les mises à jour par-dessus le dossier ; le verrou de `envs/local` est dans le dépôt (19.10), celui de `envs/switch` reste à ajouter ; sauvegarde du fichier de secrets à décider.'],
    ['23', 'Redémarrages de Mimir au premier démarrage (Kafka non prêt, constaté sur un ingester) ; cause du distributeur non vue.', 'Lire les journaux précédents du distributeur (`kubectl logs --previous`) lors d’un prochain premier démarrage.'],
    ['24', 'L’agent produit parfois une requête PromQL mal parenthésée et peut renoncer (2 cas sur 6 dans les séries du 19.10) ; le test de fumée ne le détecte pas.', 'Série de questions de test et décision du groupe : l’agent est figé en 0.4.3.'],
    ['25', 'Mémoire d’Open WebUI : 936, 989 MiB, 1,10 GiB le 18.10, puis 777, 671 et 997 MiB le 19.10. La croissance continue supposée n’est pas confirmée.', 'Relevés répétés sur plusieurs heures (`container_memory_working_set_bytes` dans Mimir).'],
    ['26', 'Secrets en clair dans les valeurs Helm et dans le fichier d’état OpenTofu.', 'Secrets Kubernetes et état distant chiffré pour tout usage au-delà du test.'],
    ['27', 'Crédits AWS restants et couverture de Bedrock par ces crédits.', 'Console de facturation AWS (crédits) ; premier appel réel facturé.'],
    ['28', 'Compte AWS peut-être partagé avec d’autres étudiants (groupe `students`) : quotas et crédits communs, risque de collision de noms.', 'Demander à l’enseignant ; préfixe de groupe et étiquettes dans tous les cas.'],
    ['29', 'Quotas de service (vCPU EC2, nombre de clusters EKS).', 'Console des quotas (lecture) avant la première session.'],
    ['30', '**TRAITÉ (25.10.2026)** : architecture de l’image : celle construite sur Mac est arm64, l’instance est x86.', 'Image reconstruite en `linux/amd64` avec `docker buildx` et poussée dans le registre GitLab ; architecture vérifiée dans le registre. Le démarrage de l’image sur l’instance n’est pas testé.'],
    ['31', '**RÉSOLU (23.10.2026)** : authentification de `kubectl` auprès d’EKS avec le CLI AWS version 1.', '`aws eks update-kubeconfig` puis `kubectl get nodes` fonctionnent (observé sur EKS, 23 et 24.10).'],
    ['32', 'Accès réseau de l’instance EC2 vers Mimir et Loki (sans authentification, jamais publics).', 'Conçu le 24.10 : NodePort 30090 et 30310 sur les nœuds, ouverts seulement au groupe de sécurité de l’hôte, un seul nœud utilisé. Écrit, jamais testé.'],
    ['33', '**DÉCIDÉ (25.10.2026)** : registre d’images pour AWS : registre de la forge GitLab.', 'Image poussée, jeton de déploiement en lecture seule créé. L’accès au registre depuis AWS n’est pas vérifié (premier démarrage de l’hôte).'],
    ['34', 'Open WebUI sur l’instance : configuration (connexion à l’assistant par `/v1`, compte administrateur), exposition, accès des collègues.', 'À concevoir ; accès restreint par adresse IP ou par tunnel.'],
    ['35', 'Consommation mémoire réelle de la pile sur EKS (dimensionnement actuel : borne déduite de Kind).', 'Première session : `container_memory_working_set_bytes` dans Mimir.'],
    ['36', 'Calibrage de l’assistant : refus hors sujet essayé une fois ; fiabilité des requêtes PromQL de Mistral Large 3 non testée.', 'Série de questions de test, avec plusieurs formulations hors sujet.'],
    ['37', 'Propriété intellectuelle et licence MIT : hypothèse du groupe.', 'Confirmation de l’enseignant.'],
  ],
  [500, 4800, 4338]));
c.push(H2('5.1 Points levés par l’installation sur Kind'));
c.push(B('Clés Mimir `insecure: true` et `bucket_lookup_type: path` : acceptées avec Garage, blocs écrits.'));
c.push(B('`loki.auth_enabled: false` et noms de services : confirmés (`loki-gateway`, `mimir-gateway`, `garage`).'));
c.push(B('Feature `podLogsViaLoki` : valide en 4.5.3. `destinations` doit être un objet, pas un tableau.'));
c.push(B('Chart Grafana : `grafana-community/grafana` 14.0.0 fonctionne.'));
c.push(B('Layout Garage en `singleNode` : appliqué automatiquement.'));
c.push(B('Dépôt Helm d’Open WebUI : `https://helm.openwebui.com/` fonctionne.'));
c.push(B('Step 3 : Open WebUI joint Ollama par `ollamaUrls` ; l’outil de l’assistant est découvert par `openapi.json` et appelé par `POST /tools/ask` (section 4.5). Un outil exposé à Open WebUI suffit ; les six outils de l’agent restent internes.'));
c.push(B('Step 3 : `qwen3:8b` appelle des outils sans réflexion activée, à condition de lui présenter peu d’outils (outils intégrés décochés) et une fenêtre de contexte suffisante.'));

// 6 cible AWS
c.push(H1('6. Cible AWS : décisions du 22 octobre 2026 et premières exécutions (23 au 25 octobre)'));
c.push(P('Le 22.10.2026, le professeur a commenté l’avancement du projet : le travail local convient et ne change pas ; trois changements concernent le cloud. Ce chapitre les consigne avec leurs justifications. Il repose sur des vérifications faites avec le CLI AWS par un membre du groupe (qui m’a transmis les sorties), sur des pages de documentation que j’ai lues, et sur des décisions du groupe. Les sections 6.10 à 6.13 (25.10.2026) ajoutent ce qui a été exécuté depuis : deux déploiements de l’infrastructure, le retrait des droits, l’hôte EC2 et le plan de tests. **L’hôte EC2 et la chaîne complète n’ont jamais fonctionné de bout en bout.**'));
c.push(note('aws', 'une commande a été exécutée par un membre du groupe avec le CLI AWS (version 1.46.1) sur son compte, et la sortie a été constatée. Ces vérifications ne font que lire et ne coûtent rien.'));

c.push(H2('6.1 Ce qui change et pourquoi'));
c.push(...table(
  ['Changement demandé', 'Décision', 'Justification', 'Niveau de confiance'],
  [
    ['Plus de Switch Cloud : espace AWS avec des crédits', 'AWS, région `us-east-1` ; cluster Amazon EKS ; stockage Amazon S3 à la place de Garage', 'Retour du professeur et décision du groupe. EKS et S3 sont des services managés : moins d’étapes manuelles que la création d’un cluster SCK. Région : celle des codelabs précédents (lue avec `aws configure get region`).', 'Région et droits observés avec le CLI ; EKS et S3 non créés'],
    ['Plus de LLM hébergé (résultats peu convaincants, ressources coûteuses) ; modèle public, usage gratuit', 'Amazon Bedrock, modèle Mistral Large 3, payé sur les crédits AWS', '« ChatGPT » et « gratuit » sont incompatibles par l’API (6.3). Bedrock est déjà autorisé sur le compte et évite une clé externe à gérer.', 'Appel d’outils observé (1 essai) ; crédits restants non vérifiés'],
    ['L’assistant ne doit pas tourner dans le cluster surveillé', 'Une instance EC2 (Docker Compose) héberge l’assistant et Open WebUI ; Mimir, Loki, Alloy et Grafana restent dans le cluster', 'Séparer ce qui mesure de ce qui consulte les mesures : un outil de diagnostic ne doit pas dépendre du cluster qu’il surveille. L’instance se crée et se supprime par script. Options comparées en 6.4.', 'Décision du groupe ; rien de déployé'],
    ['Question de test finale : « Quel temps fait-il aujourd’hui ? »', 'Règle de périmètre dans le prompt système de l’assistant', 'L’assistant doit refuser une question qui ne concerne pas la supervision du cluster.', 'Un essai réussi (section 4.12) ; à répéter sur d’autres formulations'],
    ['Données sensibles : plus une priorité', 'Aucune contrainte de confidentialité pour la cible AWS ; le local reste entièrement privé', 'Preuve de concept avec un temps limité (rendu le 3 novembre) : ne pas compliquer. Conséquence : les questions et les extraits de métriques et de logs lus par l’agent sont envoyés à Amazon Bedrock.', 'Décision du groupe'],
  ],
  [1800, 2300, 3700, 1838]));

c.push(H2('6.2 Vérifications faites avec le CLI AWS (22 octobre 2026)'));
c.push(...table(
  ['Commande', 'Résultat observé', 'Ce que cela établit'],
  [
    ['`aws sts get-caller-identity --query Arn --output text`', 'un utilisateur IAM (`user/…`), pas un rôle temporaire', 'Ce n’est probablement pas un AWS Academy Learner Lab, dont les comptes passent par un rôle temporaire (connaissance générale, non vérifiée dans la documentation lue).'],
    ['`aws configure get region`', '`us-east-1`', 'Région du CLI.'],
    ['`aws eks list-clusters`', 'liste vide', 'L’accès à EKS est autorisé ; aucun cluster n’existe.'],
    ['`aws iam list-attached-user-policies --user-name …`', 'liste vide', 'Aucune politique attachée directement à l’utilisateur.'],
    ['`aws iam list-groups-for-user --user-name …`', 'un groupe `students`, créé en septembre 2023', 'Les droits viennent du groupe. Un compte d’école est peut-être partagé avec d’autres étudiants (non vérifié).'],
    ['`aws iam list-attached-group-policies --group-name students`', '9 politiques, dont `AdministratorAccess`, `AmazonBedrockFullAccess`, `AmazonEC2FullAccess`, `AmazonS3FullAccess`, `AWSCloudFormationFullAccess`', 'Droits suffisants pour EKS, rôles IAM, S3, EC2 et Bedrock. Une règle d’organisation éventuelle ne serait pas visible ici.'],
    ['`aws bedrock list-foundation-models --by-output-modality TEXT --by-inference-type ON_DEMAND`', 'liste de modèles (Mistral, OpenAI gpt-oss, Amazon Nova, Qwen, DeepSeek, Meta, etc.) ; aucun modèle Claude dans cette liste filtrée', 'Elle montre ce que la région propose, pas ce que le compte a le droit d’invoquer. Cause de l’absence de Claude non vérifiée.'],
    ['`aws pricing get-products …`', 'prix à l’heure de quatre types d’instances', 'Voir 6.6.'],
  ],
  [3000, 3200, 3438]));
c.push(P('Le modèle `amazon.titan-embed-text-v2:0`, utilisé dans un codelab précédent, est un modèle d’embeddings (texte vers vecteurs) : il ne génère pas de réponses et ne convient pas à l’assistant (connaissance générale, non vérifiée dans la documentation lue ; il est d’ailleurs absent de la liste filtrée sur la sortie texte).'));

c.push(H2('6.3 Le modèle de langage : pourquoi pas ChatGPT, pourquoi Bedrock'));
c.push(...table(
  ['Option', 'Ce que dit la source (consultée le 22.10.2026)', 'Verdict'],
  [
    ['API OpenAI (ChatGPT)', 'Les nouveaux comptes API utilisent la facturation prépayée : achat minimum de 5 $ (10 $ par défaut) ; la page ne mentionne aucun niveau gratuit ; les crédits achetés expirent après un an.', 'Écartée : incompatible avec « gratuit ».'],
    ['API Gemini (Google)', 'Un niveau gratuit existe, mais les conditions disent : « You may use only Paid Services when making API Clients available to users in the European Economic Area, Switzerland, or the United Kingdom. » Les limites exactes du niveau gratuit sont renvoyées vers Google AI Studio et ne sont pas garanties.', 'Écartée : le groupe est en Suisse.'],
    ['Groq (`gpt-oss-20b`)', 'Tableau de limites : 30 requêtes par minute, 1 000 par jour, 8 000 tokens par minute, 200 000 tokens par jour. La page est ambiguë (en-têtes « Free Plan » et « Developer Plan »). Aucune restriction géographique sur cette page ; les conditions d’utilisation n’ont pas été lues.', 'Possible mais plafonnée ; non retenue.'],
    ['OpenRouter (modèles `:free`)', '20 requêtes par minute ; 50 requêtes par jour sans crédit acheté, 1 000 avec. La prise en charge des outils dépend du modèle (non vérifiée).', 'Possible mais plafonnée ; non retenue.'],
    ['Amazon Bedrock (Mistral Large 3)', 'Autorisé sur le compte (`AmazonBedrockFullAccess`). Prix à la demande dans les régions US East : 0,50 $ en entrée et 1,50 $ en sortie par million de tokens (page de prix AWS). Appel d’outils observé sur le compte : 1 essai, `stopReason: tool_use`, 439 ms, 91 tokens en entrée et 35 en sortie.', 'Retenue. Crédits restants et couverture de Bedrock par ces crédits : non vérifiés.'],
  ],
  [1800, 5000, 2838]));
c.push(note('val', 'les prix de Nova et de gpt-oss pour `us-east-1` n’ont pas pu être lus (la page de prix les donne pour Sydney seulement, et ne donne aucun prix Nova dans la partie lue), et la documentation des modèles qui acceptent l’appel d’outils n’a pas pu être lue. Mistral Large 3 a été choisi parce que son prix est vérifié et que son appel d’outils a été testé, pas parce qu’il serait le meilleur. Ministral 8B (0,15 $ en entrée comme en sortie) reste une option moins chère à tester.'));
c.push(P('Ordre de grandeur : une question qui n’a déclenché aucun outil a coûté environ 0,0008 $ (section 4.12). Une question avec outils fait plusieurs appels dont le prompt grossit avec les résultats : **non mesuré**. La consommation de crédits sera à relever dans la console de facturation.'));

c.push(H2('6.4 Où héberger l’assistant et Open WebUI (hors du cluster)'));
c.push(...table(
  ['Option', 'Principe', 'Avantages', 'Risques'],
  [
    ['**A. Instance EC2 (retenue)**', 'Docker Compose avec l’assistant et Open WebUI, dans le même réseau (VPC) que le cluster', 'Simple ; facturation horaire ; supprimée par `tofu destroy`', 'Accès réseau vers Mimir et Loki à restreindre ; image à construire pour l’architecture de l’instance'],
    ['B. ECS Fargate', 'Deux conteneurs gérés, derrière un load balancer', 'Aucun serveur à gérer', 'Plus de configuration (rôles IAM, load balancer facturé à l’heure)'],
    ['C. Lambda', 'L’assistant seul, en conteneur', 'Coût proche de zéro à l’arrêt', 'Open WebUI à héberger ailleurs ; durée des appels avec outils parfois supérieure à 30 s selon la passerelle (non vérifié)'],
    ['D. Mac du groupe', 'Docker Compose local et `kubectl port-forward` vers le cloud', 'Gratuit ; aucune exposition réseau', 'Pas hébergé dans le cloud ; la démonstration dépend d’une machine'],
  ],
  [1700, 2700, 2500, 2738]));
c.push(P('L’option A a été retenue par le groupe le 22.10.2026 (recommandation de ma part, décision du groupe). L’option D reste utilisable pour développer sans payer. Mimir et Loki n’ont pas d’authentification : ils ne doivent jamais être exposés publiquement, seule l’instance doit pouvoir les atteindre (accès réseau à concevoir, non fait).'));
c.push(P('**Grafana reste dans le cluster** (décision du groupe, 22.10.2026) : le professeur a parlé de l’assistant, et déplacer Grafana demanderait de réécrire sa configuration pour Docker Compose. Limite à signaler : Grafana, qui consulte les mesures, partage encore le cluster surveillé. **Open WebUI** est avec l’assistant sur l’instance : il parle à l’assistant par l’interface `/v1` (section 4.12), pas à Bedrock.'));

c.push(H2('6.5 Architecture cible et dimensionnement'));
c.push(...code(
`Compte AWS, région us-east-1
  ├─ Cluster EKS (surveillé)       Alloy ──▶ Mimir, Loki ──▶ Amazon S3 ; Grafana
  │                                2 nœuds m5.xlarge (4 vCPU, 16 Gio chacun)
  ├─ Instance EC2 (hors cluster)   Open WebUI ──▶ assistant (/v1) ──▶ Mimir, Loki
  │                                accès réseau restreint, jamais public
  └─ Amazon Bedrock                Mistral Large 3, appelé par l’assistant
                                   (rôle de l’instance, limité à ce modèle ; non testé)`));
c.push(note('notest', 'le dossier `envs/aws` et les commandes `make aws-*` existent ; l’infrastructure (réseau, EKS, S3, droits) a été créée deux fois, mais l’hôte EC2 n’a jamais été lancé et la pile complète n’a jamais tourné de bout en bout (6.10 à 6.12).'));
c.push(P('**Dimensionnement.** Sur Kind, tout tournait dans 15 Gio de mémoire Docker, dont environ 6,7 Go pour Ollama (mesuré en octobre) et environ 1 Gio pour Open WebUI. La pile sans eux (Mimir, Loki, Garage, Grafana, Alloy) tient donc dans 7 à 8 Gio au plus : **c’est une borne haute déduite, pas une mesure**. Sur EKS s’ajoutent les composants système et le pilote de volumes EBS. Le groupe a accepté 2 nœuds `m5.xlarge` pour la première session ; le nombre et le type sont des variables, à réduire après mesure (métriques de Mimir). `m5` plutôt que `t3` : l’écart est d’environ 0,05 $/h pour les deux nœuds, et les `t3` sont à performance variable, ce qui peut, à ma connaissance (non vérifié ici), entraîner un supplément en cas de forte sollicitation du processeur.'));

c.push(H2('6.6 Coûts'));
c.push(...table(
  ['Poste', 'Prix', 'Source'],
  [
    ['`m5.xlarge` (4 vCPU, 16 Gio)', '0,192 $/h par nœud, soit 0,384 $/h pour 2 nœuds', 'API de prix AWS, Linux, `us-east-1`, 22.10.2026'],
    ['`t3.xlarge`, `m5.large`, `t3.large`', '0,1664 $, 0,096 $ et 0,0832 $ par heure', 'idem'],
    ['Plan de contrôle EKS (support standard)', '0,10 $/h par cluster', 'Page de prix Amazon EKS (région non précisée sur la page)'],
    ['Mistral Large 3 (Bedrock)', '0,50 $ en entrée, 1,50 $ en sortie, par million de tokens', 'Page de prix Amazon Bedrock (US East N. Virginie, US East Ohio, US West Oregon)'],
  ],
  [3200, 3200, 3238]));
c.push(P('Nœuds et plan de contrôle : 0,384 + 0,10 = **0,484 $/h**, soit environ 1,45 $ pour une session de 3 h et environ 11,60 $ si le cluster est oublié pendant 24 h. **Non chiffrés** : volumes, load balancers, passerelle NAT éventuelle, instance EC2, trafic. Mesuré le 23.10 : une session d’environ 56 minutes, soit environ 0,45 $ (calcul d’après les prix, pas une facture). Règles retenues : sessions courtes et planifiées, script de destruction et script d’audit (liste des ressources restantes) après chaque session, étiquette de projet sur toutes les ressources. Les load balancers créés par Kubernetes ne sont pas dans l’état d’OpenTofu : il faut supprimer les services avant le cluster, sinon ils continuent d’être facturés (point connu, à vérifier au premier essai).'));

c.push(H2('6.7 Calendrier jusqu’au rendu du 3 novembre (mis à jour le 25 octobre)'));
c.push(...table(
  ['Période', 'Travail', 'État'],
  [
    ['22–23 octobre', 'Décisions, branche, vérifications AWS, assistant 0.5.0, première exécution AWS (création puis destruction)', 'fait'],
    ['24 octobre', 'Deuxième exécution : correctifs du pilote de disques et de la classe de stockage ; droits retirés à 15h17', 'fait, interrompu'],
    ['25 octobre', 'Hôte EC2, registre d’images, plan de tests, mise à jour des documents ; écriture au professeur', 'fait (hors réponse)'],
    ['26 octobre (si les droits reviennent)', 'Nettoyage du cluster de test, redéploiement complet avec l’hôte, corrections du premier démarrage', 'prévu, dépend d’AWS'],
    ['27–28 octobre', 'Exécution du plan de tests (cas d’usage, refus, puis pannes)', 'prévu'],
    ['29 octobre', 'Documents à jour, rapport de tests rempli', 'prévu'],
    ['30 octobre', 'Répétition de la démonstration, destruction finale et audit', 'prévu'],
    ['31 octobre – 2 novembre', 'Marge, relecture, plan d’amélioration', 'prévu'],
    ['3 novembre, 8h45', 'Rendu', '—'],
  ],
  [2600, 5138, 1900]));
c.push(note('val', 'si les droits AWS ne reviennent pas le 26.10 au soir, décision de passer au plan de repli : documenter AWS avec les preuves des deux exécutions et démontrer les cas d’usage sur Kind reconstruit. Les durées de la ligne du 26.10 ne sont pas mesurées. On ne sait pas encore s’il y a une présentation orale en plus du dépôt.'));

c.push(H2('6.8 Git, licence et propriété intellectuelle'));
c.push(B('**Une branche par membre** (`dev/<prénom>`), créée depuis `main` ; seul son propriétaire y pousse, les autres la récupèrent pour tester. `main` est protégée : « Allowed to push and merge : No one », « Allowed to merge : Maintainers ». Un push direct sur `main` a été refusé lors d’un test (« pre-receive hook declined », 22.10.2026). Les deux collègues ont le rôle Maintainer : ils peuvent fusionner leurs propres merge requests et modifier la protection ; aucune règle d’approbation n’est configurée.'));
c.push(B('**Licence MIT** (fichier `LICENSE`), copyright attribué à la HES-SO, sur décision d’un membre du groupe : le projet est un travail d’école, supposé appartenir à l’école. Vérification faite : le règlement du travail de Master du MAS EDD-BAT de la HES-SO (formation continue) attribue la propriété intellectuelle à la HES-SO, mais il ne concerne pas ce cours et je n’ai pas trouvé de règle générale applicable. L’attribution reste une **hypothèse**, à faire confirmer par l’enseignant ; l’accord des autres membres n’a pas été vérifié.'));

c.push(H2('6.9 Ce qui reste à vérifier'));
c.push(P('Les points 27 à 36 de la section 5, dont plusieurs ont avancé depuis le 22.10 : l’authentification de `kubectl` avec le CLI version 1 (observée, 6.10), l’architecture de l’image (image `linux/amd64` poussée dans le registre GitLab, 6.12) et le registre d’images (GitLab, 6.12) sont traités. Restent ouverts : crédits et couverture de Bedrock, compte partagé (la panne de droits touche aussi le groupe 12, 6.11), quotas, accès réseau de l’instance vers Mimir et Loki, configuration d’Open WebUI sur l’instance, mémoire réelle de la pile, calibrage de l’assistant, propriété intellectuelle.'));

c.push(H2('6.10 Exécutions AWS des 23 et 24 octobre 2026'));
c.push(P('Le déploiement se fait en deux étapes, parce que le fournisseur Helm a besoin d’un cluster qui existe déjà : `envs/aws/infra` (réseau, EKS, S3, droits, hôte EC2), puis `envs/aws/stack` (Mimir, Loki, Alloy, Grafana). Les scripts `aws-up.sh`, `aws-down.sh`, `aws-audit.sh` et `aws-allow-ip.sh` (cibles `make aws-*`) enchaînent ces étapes ; toutes nos ressources portent le préfixe `g13-p5` et des étiquettes (`Project`, `Group`, `Owner`), et nous ne touchons à rien qui ne les porte pas.'));
c.push(...table(
  ['Mesure', 'Valeur observée', 'Remarque'],
  [
    ['Création du cluster EKS', '9 min 55 s à 10 min 46 s', 'deux exécutions'],
    ['Groupe de nœuds (2 × m5.xlarge)', '1 min 19 s à 2 min', 'deux exécutions'],
    ['Modules complémentaires EKS', '16 à 47 s', 'le pilote de disques : 47 s à la deuxième exécution'],
    ['Destruction : groupe de nœuds', '8 min 10 s', 'première exécution'],
    ['Destruction : passerelle Internet', '6 min 51 s', 'première exécution'],
    ['Destruction : cluster', '3 min 8 s', 'première exécution'],
    ['Première session complète', 'environ 56 minutes, environ 0,45 $', 'calcul d’après les prix, pas une facture ; audit final : « rien trouvé »'],
  ],
  [3200, 3200, 3238]));
c.push(note('eks', 'durées lues dans les sorties des scripts, exécutés par un membre du groupe le 23.10 au soir et le 24.10 ; `kubectl` s’authentifie auprès d’EKS avec le CLI AWS version 1 (`aws eks update-kubeconfig`).'));
c.push(H3('Échecs rencontrés et corrections'));
c.push(...table(
  ['Constat', 'Cause', 'Correction', 'Niveau de preuve'],
  [
    ['Le pilote de disques EBS (CSI) redémarre en boucle : « no EC2 IMDS role found »', 'Les nœuds EKS limitent à 1 le nombre de sauts des métadonnées : un pod n’atteint pas les droits du nœud', 'Limite de sauts portée à 2 dans le groupe de nœuds', 'Observé : contrôleurs 6/6 et module créé en 47 s à la deuxième exécution'],
    ['Les volumes de Mimir et Loki restent « Pending » ; Helm dépasse son délai de 900 s', 'EKS n’a pas de classe de stockage utilisable par défaut', 'Classe `gp3` par défaut (`envs/aws/stack/storageclass.yaml`, appliquée par `aws-up.sh`)', 'Observé : volumes liés après coup, pods Mimir et Loki en `Running`'],
    ['L’audit concluait toujours « rien trouvé »', 'Une variable modifiée dans un sous-processus d’un tube était perdue', 'Drapeau dans un fichier', 'Confirmé : « RESSOURCES RESTANTES » s’affiche quand il en reste'],
    ['La console semblait figée pendant le déploiement', '`sed` retient la sortie dans un tube sur macOS', '`sed -l`', 'Observé'],
    ['L’audit listait 4 règles de groupe de sécurité', 'Entrées périmées de l’API d’étiquettes', 'Aucune : elles ont disparu le lendemain', 'Vérifié : 0 règle réelle avec `describe-security-group-rules`'],
  ],
  [2400, 2400, 2400, 2438]));
c.push(P('Redémarrages relevés le 24.10 sur EKS : trois pour les composants « ingester », jusqu’à 19 plus tôt pour « distributor » et « ruler », stables ensuite. La cause de ces redémarrages n’a pas été étudiée : elle coïncide avec la période où les volumes n’existaient pas encore, mais cela n’est pas démontré.'));
c.push(H3('État au moment où les droits ont été retirés (24.10, 15h17)'));
c.push(B('Les deux nœuds sont `Ready` ; Mimir et Loki sont en `Running`.'));
c.push(B('Alloy et Grafana **ne sont pas installés** : l’étape 2 n’est jamais allée au bout, et les composants Helm de Mimir et Loki sont marqués échoués dans l’état d’OpenTofu (délai dépassé avant la classe de stockage).'));
c.push(B('10 volumes EBS (créés pour les volumes persistants), un utilisateur IAM `g13-p5-s3-access` avec une clé d’accès active, six buckets S3 `g13-p5-<hex>-*`.'));
c.push(note('notest', 'l’écriture de Mimir et Loki dans S3 n’a pas été constatée (pods `Running`, aucune donnée relue) ; l’accessibilité des NodePort 30090 et 30310 depuis le groupe de sécurité de l’hôte n’a pas été testée ; les durées d’installation de Mimir et Loki avec Helm ne sont pas mesurées.'));
c.push(note('notest', 'l’image de l’assistant construite sur Mac est `arm64` ; une instance EC2 `t3` est `x86_64` : image reconstruite en `linux/amd64` (6.12).'));

c.push(H2('6.11 Retrait des droits AWS (24 octobre 2026, 15h17)'));
c.push(P('Le 24.10 à 15h17, l’utilisateur IAM du membre du groupe a perdu l’accès à IAM et à EKS : chaque appel échoue avec « no identity-based policy allows the action », y compris `eks:ListClusters`, `eks:DescribeCluster`, `iam:ListGroupsForUser` et `iam:ListAttachedUserPolicies`. La console AWS affiche les mêmes erreurs. L’identité reste valide, et Amazon Bedrock répond encore (appel du modèle réussi le 25.10). Le message ne mentionne pas de refus explicite (« explicit deny »). **La cause est inconnue** : on ne sait pas si le retrait est volontaire. Sur le premier constat (22.10), le groupe `students` portait la politique `AdministratorAccess`.'));
c.push(...table(
  ['Date et heure', 'Fait'],
  [
    ['24.10, 15h17', 'Premier `AccessDenied` pendant `aws-up.sh`, alors que le cluster de test tourne depuis environ 13h56 (≈ 0,48 $/h)'],
    ['24.10, ≈ 15h47', '`kubectl get nodes` : les deux nœuds sont `Ready`, depuis 110 minutes (l’accès au cluster passe par ses propres droits Kubernetes)'],
    ['24.10, après-midi', 'Message dans le canal Général de Teams, avec mention d’un assistant et des enseignants'],
    ['24.10, 19h34', 'Message d’étudiants du groupe 12 (projet 1) décrivant le même type de refus sur d’autres services (Lambda, DynamoDB, RDS), dans une autre région'],
    ['25.10, 00h32 et 13h50', 'Mêmes refus ; aucune réponse constatée du côté des enseignants'],
    ['25.10, soir', 'Courriel au professeur (prévu), texte court renvoyant au message Teams'],
  ],
  [2600, 7038]));
c.push(P('**Décision de ne pas contourner.** Le cluster reste en place et facturé, mais nous n’avons pas essayé de le réduire (mise à l’échelle du groupe de nœuds, arrêt d’instances, suppression de volumes) : si le retrait est volontaire, le contourner irait contre la règle que quelqu’un a voulu poser. On attend la réponse d’un administrateur. Le coût en attendant est d’environ 11,60 $ par jour. Nous ne touchons à aucune ressource qui ne porte pas notre préfixe.'));
c.push(note('notest', 'le nombre de nœuds `Ready` après le 24.10 à 15h47 n’a pas été relevé : l’état actuel du cluster n’est pas connu avec certitude.'));

c.push(H2('6.12 L’hôte EC2 : conception du 25 octobre et points non vérifiés'));
c.push(P('L’hôte (`envs/aws/infra/host.tf` et deux modèles) est une instance `t3.small` dans un sous-réseau public qui lance, avec Docker Compose, l’assistant (configuré pour Bedrock) et Open WebUI. Les décisions et leurs raisons :'));
c.push(B('**Taille t3.small (2 Gio).** Open WebUI occupait environ 0,7 Gio sur Kind (relevé du 17.10). La mémoire de l’assistant, de Docker et du système n’est pas mesurée sur AWS ; `t3.micro` (1 Gio) est jugé trop juste (estimation).'));
c.push(B('**Image dans le registre GitLab du projet**, pas dans S3. Une construction sur l’instance aurait évité un secret, mais le groupe a préféré le registre, « fait pour cela ». L’image a été construite en `linux/amd64` avec `docker buildx` (50 s, poussée), et son architecture est vérifiée dans le registre. Un **jeton de déploiement** en lecture seule (`read_registry`) est lu par l’instance, avec une date d’expiration.'));
c.push(B('**Secrets dans SSM Parameter Store** (jeton du registre, mot de passe d’Open WebUI généré par OpenTofu), lus avec le rôle de l’instance, pas dans `user_data` (visible dans la description de l’instance).'));
c.push(B('**Rôle de l’instance limité** à l’appel du modèle Bedrock choisi et à la lecture de ces deux paramètres, plus la politique gérée `AmazonSSMManagedInstanceCore` pour l’accès par session SSM (aucun port ouvert, aucune clé SSH).'));
c.push(B('**Métadonnées : limite de sauts à 2**, pour que les conteneurs atteignent les droits du rôle (même cause que le pilote de disques d’EKS).'));
c.push(B('**Accès à Mimir et Loki par un seul nœud EKS** (NodePort 30090 et 30310), ouverts seulement au groupe de sécurité de l’hôte. Si ce nœud est remplacé, l’hôte doit être recréé.'));
c.push(B('**Open WebUI sur le port 3000**, en HTTP, limité à nos adresses IP ; `/v1` de l’assistant n’est pas publié.'));
c.push(note('code', 'le code est écrit et `tofu validate` réussit (25.10.2026) ; cela vérifie la syntaxe et les références, pas le comportement.'));
c.push(note('notest', 'jamais lancé : accès au registre HEFR depuis AWS, déchiffrement SSM avec la clé gérée par défaut, autorisation Bedrock sur le modèle (un profil d’inférence pourrait être exigé), étiquette `eks:cluster-name` des nœuds, versions de Compose (`v2.29.7`) et d’Open WebUI (`v0.12.0`), agent SSM présent dans l’image, droits de l’utilisateur pour ouvrir une session SSM.'));
c.push(note('eks', 'Bedrock, 25.10 : appel Converse du modèle `mistral.mistral-large-3-675b-instruct` réussi (11 tokens), alors que ce modèle n’apparaît pas dans la liste filtrée par fournisseur Mistral (cause inconnue).'));

c.push(H2('6.13 Plan de tests et démonstration'));
c.push(P('Le plan (`docs/tests/plan-de-tests.md`) comporte 14 scénarios : fonctionnels (F1 à F4 : santé du cluster, description d’un incident, cause racine, exactitude des chiffres), sécurité et périmètre (S1 à S7 : hors sujet, demande d’action, consigne cachée dans les logs, secrets, demande trop grande, refus non excessif, tentatives de contournement) et résilience (R1 à R3). Chaque scénario a une réussite définie à l’avance et un tableau de résultats, vide tant qu’il n’est pas exécuté. Les scénarios de refus (S1, S2, S4, S6, S7) peuvent s’exécuter sans cluster : l’assistant tourne sur le poste avec le vrai modèle Bedrock (`scripts/run_scenarios.py`) ; les résultats sont alors notés « local, Bedrock » et non « AWS ». Le déroulé de la démonstration est dans `docs/demo/deroule-demonstration.md`.'));
c.push(note('eks', 'refus exécutés le 25.10.2026 en local avec le vrai modèle Bedrock (S1 : 5 questions hors sujet, S2 : 3 demandes d’action, S4 : 2 demandes de secrets, S6 : salutation, S7 : 4 tentatives de contournement), un essai par formulation, sans cluster. Résultat : 14 réponses sur 15 conformes à notre lecture, une partielle (la question mixte de S7 : la blague n’est ni faite ni refusée explicitement). Jugement à valider par le groupe. Détail brut : `docs/tests/resultats/2026-10-25-local-bedrock.md`.'));
c.push(note('notest', 'non exécutés : les cas d’usage F1 à F4 (ils demandent un cluster avec des données), la consigne cachée dans les logs (S3), la demande trop grande (S5) et les pannes (R1 à R3). Un essai par formulation ne mesure pas la robustesse : le modèle est appelé à température 0.'));


// 7 sources
c.push(H1('7. Sources consultées (12 au 22 octobre 2026)'));
const srcs = [
  ['Kind, Quick Start', 'https://kind.sigs.k8s.io/docs/user/quick-start/'],
  ['Loki, installation Helm monolithique', 'https://grafana.com/docs/loki/latest/setup/install/helm/install-monolithic/'],
  ['Chart Loki communautaire (README)', 'https://github.com/grafana-community/helm-charts/blob/main/charts/loki/README.md'],
  ['Mimir, démarrage avec le chart Helm', 'https://grafana.com/docs/helm-charts/mimir-distributed/latest/get-started-helm-charts/'],
  ['Mimir, production avec Helm (MinIO, Kafka)', 'https://grafana.com/docs/helm-charts/mimir-distributed/latest/run-production-environment-with-helm/'],
  ['Mimir, configuration du stockage objet', 'https://grafana.com/docs/mimir/latest/configure/configure-object-storage-backend/'],
  ['k8s-monitoring-helm (dépôt)', 'https://github.com/grafana/k8s-monitoring-helm'],
  ['Chart k8s-monitoring, vue d’ensemble', 'https://grafana.com/docs/grafana-cloud/monitor-infrastructure/kubernetes-monitoring/configuration/helm-chart-config/helm-chart/'],
  ['Open WebUI, Quick Start', 'https://docs.openwebui.com/getting-started/quick-start/'],
  ['Open WebUI, charts Helm', 'https://github.com/open-webui/helm-charts'],
  ['Garage, déploiement sur Kubernetes', 'https://garagehq.deuxfleurs.fr/documentation/cookbook/kubernetes/'],
  ['Garage, Quick Start', 'https://garagehq.deuxfleurs.fr/documentation/quick-start/'],
  ['Switch Cloud, documentation', 'https://cloud.switch.ch/-/documentation/'],
  ['Switch Cloud, créer un cluster (SCK)', 'https://cloud.switch.ch/-/documentation/kubernetes/getting-started/create-a-cluster/'],
  ['Switch Cloud, créer un cluster par l’API KKP', 'https://cloud.switch.ch/-/documentation/kubernetes/guides/create-a-cluster-using-the-kkp-api/'],
  ['Open WebUI, serveurs d’outils OpenAPI', 'https://docs.openwebui.com/features/extensibility/plugin/tools/openapi-servers/'],
  ['LangChain, ChatOllama', 'https://docs.langchain.com/oss/python/integrations/chat/ollama'],
  ['Switch Cloud, flavors (GPU)', 'https://cloud.switch.ch/-/documentation/compute/compute-quick-start/flavors'],
  ['Open WebUI, code source (tag v0.12.0 : `backend/open_webui/utils/middleware.py`, `backend/open_webui/config.py`)', 'https://github.com/open-webui/open-webui/tree/v0.12.0'],
  ['Article HUG (cité dans le projet)', 'https://medium.com/@houcembenmahfoudh/monitor-kubernetes-clusters-with-ai-practical-use-case-7a8d5b2350b2'],
  ['Grafana, migration du chart k8s-monitoring vers la v4', 'https://grafana.com/docs/grafana-cloud/observe-and-act/monitor-infrastructure/kubernetes-monitoring/configuration/helm-chart-config/helm-chart/migrate-helm-chart.md'],
  ['Grafana, migration des dépôts Helm vers grafana-community', 'https://community.grafana.com/t/helm-repository-migration-grafana-community-charts/160983'],
  ['OpenAI, facturation prépayée de l’API', 'https://help.openai.com/en/articles/8264644-how-can-i-set-up-prepaid-billing'],
  ['Gemini API, conditions d’utilisation', 'https://ai.google.dev/gemini-api/terms'],
  ['Gemini API, limites', 'https://ai.google.dev/gemini-api/docs/rate-limits'],
  ['Gemini API, compatibilité OpenAI', 'https://ai.google.dev/gemini-api/docs/openai'],
  ['Groq, limites', 'https://console.groq.com/docs/rate-limits'],
  ['OpenRouter, limites', 'https://openrouter.ai/docs/api-reference/limits'],
  ['Prix Amazon EKS', 'https://aws.amazon.com/eks/pricing/'],
  ['Prix Amazon Bedrock', 'https://aws.amazon.com/bedrock/pricing/'],
  ['Open WebUI, intégration Amazon Bedrock', 'https://docs.openwebui.com/tutorials/integrations/amazon-bedrock'],
  ['AWS Academy Learner Lab, services de base (2021 ; consulté, ne s’applique pas au compte du groupe)', 'https://cyberlab.pacific.edu/courses/comp175/resources/aws-academy/AWS_Academy_Learner_Lab-Foundational_Services.pdf'],
  ['HES-SO, règlement du travail de Master MAS EDD-BAT (propriété intellectuelle, art. 11 ; ne concerne pas ce cours)', 'https://www.hes-so.ch/fileadmin/documents/HES-SO/Documents_HES-SO/pdf/formation-continue/Reglement-travail-Master-MAS-EDD-BAT-5298.pdf'],
];
srcs.forEach(([t, u]) => c.push(B(`${t} : ${u}`)));
c.push(B('FAQ Ollama (citation sur Docker Desktop et le GPU, section 4.8) : page consultée, URL non conservée.'));
c.push(P('Les pages Mimir et Loki « latest » évoluent vite (la page Loki annonce elle-même le retrait de MinIO au 31.10.2026) : revérifiez-les avant de vous fier à un détail.'));

const doc = new Document({
  creator: 'Claude',
  title: 'Stack d’observabilité Kubernetes pour le Projet 5',
  styles: {
    default: { document: { run: { font: 'Arial', size: 21 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: 'Arial', color: '1F3864' }, paragraph: { spacing: { before: 360, after: 160 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: 'Arial', color: '2F5496' }, paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 23, bold: true, font: 'Arial' }, paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } },
                                   { level: 1, format: LevelFormat.BULLET, text: '–', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1080, hanging: 270 } } } }] },
      { reference: 'num2', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: 'num3', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: 'num', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
    ],
  },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Projet 5 — stack d’observabilité — page ', size: 17, color: '7F7F7F' }), new TextRun({ children: [PageNumber.CURRENT], size: 17, color: '7F7F7F' })] })] }) },
    children: c,
  }],
});

Packer.toBuffer(doc).then((buf) => { fs.writeFileSync('../Projet5-Stack-Observabilite-Kubernetes.docx', buf); console.log('ok'); });
