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
c.push(new Paragraph({ children: [new TextRun({ text: 'Monitoring Kubernetes clusters with AI — mise en place locale (Kind) puis sur Switch Cloud', size: 26, color: '595959' })], spacing: { after: 80 } }));
c.push(new Paragraph({ children: [new TextRun({ text: 'CloudSys / Cloud Services and Systems — HES-SO Master — document de travail, mis à jour le 19 octobre 2026', size: 20, color: '595959' })], spacing: { after: 240 } }));

c.push(new TableOfContents('Table des matières', { hyperlink: true, headingStyleRange: '1-2' }));

// 0
c.push(H1('0. À lire d’abord : ce qui a été vérifié, et ce qui ne l’a pas été'));
c.push(P('Ce document décrit comment installer **k8s-monitoring (Alloy), Loki, Mimir (sans MinIO), Grafana et Open WebUI**, d’abord à la main sur un cluster Kind, puis de façon automatisée sur Switch Cloud. Le « Step 3 » (Ollama + image FastAPI avec agent LangChain/LangGraph + liaison avec Open WebUI) a été réalisé en local sur Kind : la section 4 décrit ce qui a été fait et mesuré, les décisions retenues et leurs justifications.'));
c.push(P('**État des vérifications (16.10.2026).** L’environnement dans lequel ce document a été rédigé n’avait ni Kind, ni Helm, ni OpenTofu avec ses fournisseurs, et ne pouvait pas joindre ghcr.io, get.helm.sh ou releases.hashicorp.com : je n’ai donc exécuté aucune commande moi-même. **La partie 1 (installation manuelle sur Kind) a en revanche été exécutée par un membre du groupe sur un Mac, du 14 au 16 octobre 2026, et les sorties des commandes m’ont été transmises.** Ce qui a été constaté ainsi porte l’étiquette « observé sur Kind ». **Mise à jour du 19.10.2026 :** la partie de l’automatisation qui vise Kind (OpenTofu, scripts, Makefile, y compris Ollama, l’assistant et la configuration d’Open WebUI) a été exécutée par le même membre du groupe les 18 et 19 octobre, avec un test de fumée de 6 contrôles ; les résultats, les échecs rencontrés et leurs corrections sont en section 3.7. **Le déploiement sur Switch Cloud (dossier `envs/switch`, scripts `sck-*` et `scs3-*`) n’a jamais été exécuté.** Le Step 3 avait d’abord été exécuté à la main sur Kind (15 et 16 octobre). Cinq étiquettes signalent le niveau de confiance :'));
c.push(note('obs', 'la commande a été exécutée sur le cluster Kind d’un membre du groupe et le résultat a été constaté (sortie de commande, requête, capture d’écran).'));
c.push(note('doc', 'le point a été lu dans la documentation officielle (lien dans la section Sources).'));
c.push(note('code', 'le point a été lu dans le code source (Open WebUI v0.12.0, code de l’assistant) ; le code lu est celui de la version déployée, mais lire n’est pas exécuter.'));
c.push(note('notest', 'la commande ou le code est cohérent avec la doc mais n’a jamais été exécuté. C’est le cas de tout ce qui vise Switch Cloud (`envs/switch`, scripts `sck-*` et `scs3-*`, `switch-image`, `switch-apply`).'));
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
c.push(H1('3. Partie 2 — Automatisation et déploiement sur Switch Cloud'));
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
├─ envs/switch/                        module seul (cluster SCK + SCS3)
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
    ['2', 'La fenêtre de contexte d’Ollama est d’environ 2048 tokens (limite 2050 dans le log).', 'Non expliquée : la doc annonce 4096 par défaut et `ollama run` affiche 4096 ; Open WebUI ne fixe pas de `num_ctx` dans son code.', 'Fixer 8192 explicitement pour le modèle, comme l’agent.', 'Appliqué ; l’écart avec la doc reste à comprendre'],
    ['3', 'La reformulation par Open WebUI ajoute des conclusions non fondées (« toutes passées avec succès », « fonctionnement normal »).', 'Établie : ces phrases viennent du second passage d’Open WebUI (le modèle les ajoute après l’outil). La réponse brute de l’agent est, elle, un peu large (« absence d’erreurs ou d’échecs » alors que 2 lignes seulement ont été examinées).', 'Prompt système de recopie (4.5).', 'Atténué sur 4 essais (3 questions différentes) ; garantie non démontrée'],
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

// 5 points ouverts
c.push(H1('5. Points ouverts et vérifications à faire'));
c.push(...table(
  ['#', 'Point', 'Comment le lever'],
  [
    ['1', 'Que veut dire « Mimir sans MinIO » pour le professeur ? Le chart exige un S3 sans MinIO.', 'Question au professeur. En attendant : Garage en local, SCS3 dans le cloud.'],
    ['2', 'Endpoint, région, clés et unicité des noms de buckets SCS3.', 'Pages SCS3 « User Authentication » et « Create an S3 Bucket », ou portail.'],
    ['3', 'Votre projet a-t-il accès à SCK et SCS3 ? Quotas et coûts ?', 'Portail Switch Cloud / support.'],
    ['4', 'La collecte s’interrompt-elle quand le Mac passe en veille ? (creux observés dans `count(up)`, cause non vérifiée)', 'Mettre le Mac en veille volontairement, puis observer `count(up)` et les redémarrages de pods.'],
    ['5', 'Métriques de nœud : node-exporter n’est pas déployé. Faut-il l’ajouter (CPU et mémoire des nœuds) ?', 'Décision du groupe ; features `clusterMetrics` / `hostMetrics` du chart.'],
    ['6', 'Format de sortie de `garage key create` attendu par `garage-init.sh`. **Levé** : script exécuté avec succès sur un cluster neuf (18 et 19.10).', 'Rien à faire en local ; à refaire en lecture seule pour SCS3.'],
    ['7', 'Provider Helm 3.x (syntaxe différente) et formules Homebrew.', 'Doc du provider ; `brew search`.'],
    ['8', 'Création du cluster SCK en automatique (JSON, presets, kubeconfig).', 'Pages Switch « KKP API » et « Manage a Cluster ».'],
    ['9', 'Step 3 : `qwen3:8b` et appel d’outils. **Levé en partie** : fonctionne dans l’agent et dans Open WebUI avec les réglages de 4.5 ; fiabilité sur des questions libres non mesurée ; vitesse mesurée (9 à 12 tokens/s).', 'Série de questions de test systématique (cas d’usage du sujet) avec résultats consignés.'],
    ['10', 'Step 3 : GPU Switch utilisable dans SCK ? Quotas ?', 'Support Switch Cloud.'],
    ['11', 'Step 3 : registre d’images pour l’image de l’assistant en cloud.', 'Choix du groupe.'],
    ['12', 'Fenêtre de contexte d’Ollama : limite de 2050 tokens observée alors que la doc annonce 4096 par défaut.', 'Comprendre pourquoi les requêtes d’Open WebUI étaient limitées à 2050 (logs de démarrage d’Ollama, variables d’environnement du pod).'],
    ['13', 'Comparaison `qwen3:8b` / `gpt-oss:20b` demandée par le sujet : non faite (14 Go ne tiennent probablement pas dans la VM Docker).', 'Ollama installé sur macOS (GPU) ou VM Docker plus grande ; mêmes questions de test.'],
    ['14', 'Version 0.4.1 : unités vérifiées le 17.10 sur une question (réponse identique au relevé direct) ; autres requêtes en octets et autres questions non essayées ; prompt de recopie essayé sur 4 essais seulement (3 questions différentes). L’écart sur ollama (3,09 GiB affiché, 6,70 GiB une minute plus tard) est expliqué : chargement du modèle en cours (voir 4.6, constat 6).', 'Autres questions de test (cas d’usage du sujet).'],
    ['15', 'Niveau de log DEBUG d’Open WebUI encore actif. Les réglages du modèle (outils intégrés, contexte, prompt, think) sont stockés dans le volume d’Open WebUI ; ils sont désormais réappliqués par `webui-bootstrap.sh`, mais les variables d’environnement du chart ne servent qu’au premier démarrage.', 'Commande de retour en 4.7 ; ne pas modifier ces variables sur un Open WebUI déjà initialisé sans supprimer son volume.'],
    ['16', '**Levé en local** : le module OpenTofu déploie Ollama (le chart télécharge le modèle) et l’assistant sur un cluster neuf (19.10, section 3.7). Reste : une exécution d’un seul tenant sans intervention avec toutes les corrections (en cours).', 'Consigner le résultat de cette exécution.'],
    ['17', 'Assistant sans authentification ; limite mémoire de 512 Mi estimée.', 'NetworkPolicy ou jeton ; `kubectl top pod -n assistant`.'],
    ['18', 'Pourquoi l’interrupteur « API Ollama » d’Open WebUI était-il désactivé au départ ?', 'Non expliqué ; à observer lors d’une réinstallation.'],
    ['19', 'Interprétation de « Mimir sans MinIO » : voir le point 1 (toujours à confirmer).', 'Question au professeur.'],
    ['20', 'Accès sortant vers `huggingface.co` : Open WebUI télécharge un modèle d’embedding à son premier démarrage.', 'Autoriser l’accès sur SCK ou précharger le modèle ; à vérifier avec le support.'],
    ['21', 'Architecture des nœuds SCK (amd64 ?) et registre d’images pour `make switch-image` (construction `linux/amd64`).', 'Doc Switch « Flavors » / portail ; choix du registre (point 11).'],
    ['22', 'Fichiers locaux non versionnés (secrets, état OpenTofu, clés S3, verrou des fournisseurs) : perdus si le dossier est recréé.', 'Extraire les mises à jour par-dessus le dossier ; le verrou de `envs/local` est dans le dépôt (19.10), celui de `envs/switch` reste à ajouter ; sauvegarde du fichier de secrets à décider.'],
    ['23', 'Redémarrages de Mimir au premier démarrage (Kafka non prêt, constaté sur un ingester) ; cause du distributeur non vue.', 'Lire les journaux précédents du distributeur (`kubectl logs --previous`) lors d’un prochain premier démarrage.'],
    ['24', 'L’agent produit parfois une requête PromQL mal parenthésée et peut renoncer (2 cas sur 6 dans les séries du 19.10) ; le test de fumée ne le détecte pas.', 'Série de questions de test et décision du groupe : l’agent est figé en 0.4.3.'],
    ['25', 'Mémoire d’Open WebUI : 936, 989 MiB, 1,10 GiB le 18.10, puis 777, 671 et 997 MiB le 19.10. La croissance continue supposée n’est pas confirmée.', 'Relevés répétés sur plusieurs heures (`container_memory_working_set_bytes` dans Mimir).'],
    ['26', 'Secrets en clair dans les valeurs Helm et dans le fichier d’état OpenTofu.', 'Secrets Kubernetes et état distant chiffré pour tout usage au-delà du test.'],
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

// 6 sources
c.push(H1('6. Sources consultées (12 au 16 octobre 2026)'));
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
