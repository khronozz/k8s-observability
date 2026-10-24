# Hôte EC2 : assistant + Open WebUI en Docker Compose, EN DEHORS du cluster surveillé (retour du 22.10.2026).
# NON TESTÉ : écrit sans pouvoir exécuter tofu (voir les points « à vérifier » en commentaire).

# Image Amazon Linux 2023 (x86_64) la plus récente. Le motif exclut les variantes « minimal » et « ecs ».
data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }
  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}

# Adresse privée d'un nœud EKS : l'assistant joint Mimir et Loki par leurs NodePort (30090 / 30310), ouverts par
# les règles `nodes_from_host` à ce seul groupe de sécurité. À VÉRIFIER : l'étiquette `eks:cluster-name` est posée
# par EKS sur les instances d'un groupe de nœuds gérés (lu dans la documentation, jamais constaté ici).
# Limite : une seule adresse est retenue. Si ce nœud est remplacé, l'hôte doit être recréé (tofu apply).
data "aws_instances" "eks_nodes" {
  filter {
    name   = "tag:eks:cluster-name"
    values = [module.eks.cluster_name]
  }
  filter {
    name   = "instance-state-name"
    values = ["running"]
  }
  depends_on = [module.eks]
}

locals {
  node_ip   = length(data.aws_instances.eks_nodes.private_ips) > 0 ? sort(data.aws_instances.eks_nodes.private_ips)[0] : ""
  mimir_url = "http://${local.node_ip}:${var.gateway_node_ports.mimir}/prometheus"
  loki_url  = "http://${local.node_ip}:${var.gateway_node_ports.loki}"
}

# Secrets de l'application, générés ici (jamais saisis) ; ils restent dans l'état OpenTofu local, ignoré par Git.
resource "random_password" "webui_admin" {
  length  = 24
  special = false
}

resource "random_password" "webui_secret_key" {
  length  = 48
  special = false
}

# Les secrets sont lus par l'instance dans SSM Parameter Store (SecureString) avec son rôle, pas posés dans user_data
# (visible dans la description de l'instance). À VÉRIFIER : le déchiffrement avec la clé gérée par défaut (aws/ssm)
# sans autorisation KMS explicite dans le rôle.
resource "aws_ssm_parameter" "registry_token" {
  name  = "/${var.prefix}/host/registry-token"
  type  = "SecureString"
  value = var.registry_token
}

resource "aws_ssm_parameter" "webui_env" {
  name = "/${var.prefix}/host/webui-env"
  type = "SecureString"
  value = join("\n", [
    "WEBUI_SECRET_KEY=${random_password.webui_secret_key.result}",
    "WEBUI_ADMIN_EMAIL=${var.webui_admin_email}",
    "WEBUI_ADMIN_NAME=Admin",
    "WEBUI_ADMIN_PASSWORD=${random_password.webui_admin.result}",
  ])
}

# Rôle de l'instance : appeler CE modèle Bedrock et lire CES deux paramètres, rien d'autre.
# À VÉRIFIER : l'appel Converse d'un identifiant de modèle simple s'autorise sur l'ARN foundation-model ; si Bedrock
# exige un profil d'inférence, l'erreur AccessDenied le dira.
data "aws_iam_policy_document" "host_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "host" {
  statement {
    sid       = "BedrockModele"
    actions   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
    resources = ["arn:aws:bedrock:${var.region}::foundation-model/${var.bedrock_model_id}"]
  }
  statement {
    sid       = "LireSecrets"
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.registry_token.arn, aws_ssm_parameter.webui_env.arn]
  }
}

resource "aws_iam_role" "host" {
  name               = "${var.prefix}-host"
  assume_role_policy = data.aws_iam_policy_document.host_assume.json
}

resource "aws_iam_role_policy" "host" {
  name   = "bedrock-et-secrets"
  role   = aws_iam_role.host.id
  policy = data.aws_iam_policy_document.host.json
}

# Accès à l'hôte par session SSM (Session Manager) : aucun port à ouvrir, aucune clé SSH. Sert à lire les journaux de
# démarrage, mesurer la mémoire et redémarrer l'assistant (test R2). À VÉRIFIER : l'agent SSM est censé être déjà
# présent dans l'image Amazon Linux 2023 (non constaté), et il faut le module session-manager-plugin côté poste.
resource "aws_iam_role_policy_attachment" "host_ssm" {
  role       = aws_iam_role.host.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "host" {
  name = "${var.prefix}-host"
  role = aws_iam_role.host.name
}

resource "aws_instance" "host" {
  ami                         = data.aws_ami.al2023.id
  instance_type               = var.host_instance_type
  subnet_id                   = aws_subnet.public[0].id
  vpc_security_group_ids      = [aws_security_group.host.id]
  iam_instance_profile        = aws_iam_instance_profile.host.name
  associate_public_ip_address = true

  # Hop limit 2 : sans lui, les conteneurs Docker (un saut de plus) n'atteignent pas les identifiants du rôle.
  # Même cause que le blocage du pilote EBS CSI sur EKS (constaté le 24.10.2026).
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
    encrypted   = true
  }
  # Les étiquettes par défaut du fournisseur ne couvrent pas le volume racine : on les répète pour l'audit.
  volume_tags = {
    Name    = "${var.prefix}-host"
    Project = "P5-monitoring-k8s-ai"
    Group   = "13"
  }

  user_data = templatefile("${path.module}/host.user_data.sh.tftpl", {
    region            = var.region
    compose_version   = var.compose_version
    registry_host     = var.registry_host
    registry_username = var.registry_username
    token_param       = aws_ssm_parameter.registry_token.name
    env_param         = aws_ssm_parameter.webui_env.name
    compose = templatefile("${path.module}/host.compose.yaml.tftpl", {
      assistant_image  = var.assistant_image
      webui_image      = var.webui_image
      mimir_url        = local.mimir_url
      loki_url         = local.loki_url
      bedrock_model_id = var.bedrock_model_id
      region           = var.region
    })
  })
  user_data_replace_on_change = true

  tags = { Name = "${var.prefix}-host" }

  # La sortie Internet (images, paquets) et les secrets doivent exister avant le démarrage du script.
  depends_on = [
    aws_vpc_security_group_egress_rule.host_all,
    aws_iam_role_policy.host,
    aws_internet_gateway.main,
  ]

  lifecycle {
    precondition {
      condition     = local.node_ip != ""
      error_message = "Aucun nœud EKS en cours d'exécution trouvé avec l'étiquette eks:cluster-name : impossible de fixer l'adresse de Mimir et Loki."
    }
  }
}
