# Cluster EKS (module communautaire terraform-aws-modules/eks, v21.25.0 : noms d'entrées lus dans variables.tf du module).
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 21.25"

  name               = "${var.prefix}-eks"
  kubernetes_version = var.kubernetes_version

  vpc_id     = aws_vpc.main.id
  subnet_ids = aws_subnet.public[*].id

  # API publique limitée à admin_cidrs. L'accès privé est activé aussi : sans lui, les nœuds (adresse publique
  # hors admin_cidrs) ne pourraient pas joindre l'API. Raisonnement non vérifié en pratique.
  endpoint_public_access       = true
  endpoint_public_access_cidrs = var.admin_cidrs
  endpoint_private_access      = true

  # L'utilisateur IAM qui lance `tofu apply` devient administrateur du cluster.
  enable_cluster_creator_admin_permissions = true

  # Preuve de concept, facture surveillée (23.10.2026) : on retire trois défauts du module qui créent des ressources
  # facturées ou qui survivent à la destruction : clé KMS de chiffrement des secrets (suppression différée), journaux du
  # plan de contrôle dans CloudWatch, fournisseur OIDC (IRSA, inutilisé : les droits passent par le rôle des nœuds).
  create_kms_key              = false
  attach_encryption_policy    = false
  encryption_config           = null
  enabled_log_types           = []
  create_cloudwatch_log_group = false
  enable_irsa                 = false

  addons = {
    coredns    = {}
    kube-proxy = {}
    vpc-cni = {
      before_compute = true
    }
    # Nécessaire aux volumes persistants de Mimir, Loki et Grafana. Droits donnés via le rôle des nœuds (ci-dessous),
    # plus simple qu'un rôle par compte de service. NON vérifié : comportement du stockage par défaut sur cette version.
    aws-ebs-csi-driver = {}
  }

  eks_managed_node_groups = {
    main = {
      name           = "${var.prefix}-nodes"
      instance_types = [var.node_instance_type]
      ami_type       = "AL2023_x86_64_STANDARD"

      # Constaté le 23.10.2026 (premier essai) : avec la valeur par défaut du module (hop limit = 1), les pods ne
      # joignent pas le service de métadonnées des nœuds ("no EC2 IMDS role found") et le pilote de volumes EBS
      # reste en CrashLoopBackOff. Avec 2, tous les pods des nœuds peuvent lire les droits du rôle des nœuds :
      # compromis accepté pour la preuve de concept (alternative plus stricte : Pod Identity, non écrite).
      metadata_options = {
        http_endpoint               = "enabled"
        http_tokens                 = "required"
        http_put_response_hop_limit = 2
      }
      min_size     = var.node_count
      max_size     = var.node_count
      desired_size = var.node_count

      iam_role_additional_policies = {
        ebs_csi = "arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy"
      }
    }
  }
}

# L'instance EC2 (assistant) joint les passerelles Mimir et Loki sur les nœuds : seuls ces deux ports, seul son groupe
# de sécurité.
resource "aws_vpc_security_group_ingress_rule" "nodes_from_host" {
  for_each                     = tomap(var.gateway_node_ports)
  security_group_id            = module.eks.node_security_group_id
  referenced_security_group_id = aws_security_group.host.id
  ip_protocol                  = "tcp"
  from_port                    = each.value
  to_port                      = each.value
  description                  = "${var.prefix} passerelle ${each.key} depuis hote assistant"
}
