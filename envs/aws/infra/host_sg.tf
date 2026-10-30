# Groupe de sécurité de l'instance EC2 (assistant + Open WebUI). L'instance elle-même est ajoutée à l'étape suivante.
resource "aws_security_group" "host" {
  name        = "${var.prefix}-host"
  description = "Hote assistant et Open WebUI (groupe 13, projet 5)"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${var.prefix}-host" }
}

# Open WebUI (HTTP, port 3000) depuis les adresses d'administration seulement. Pas de TLS : preuve de concept.
resource "aws_vpc_security_group_ingress_rule" "webui" {
  for_each          = toset(var.admin_cidrs)
  security_group_id = aws_security_group.host.id
  cidr_ipv4         = each.value
  ip_protocol       = "tcp"
  from_port         = 3000
  to_port           = 3000
  description       = "Open WebUI depuis une adresse admin"
}

resource "aws_vpc_security_group_egress_rule" "host_all" {
  security_group_id = aws_security_group.host.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
  description       = "Sortie libre (Bedrock, mises a jour, images)"
}
