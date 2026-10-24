output "region" {
  value = var.region
}

output "cluster_name" {
  value = module.eks.cluster_name
}

output "bucket_prefix" {
  value = local.bucket_prefix
}

output "s3_access_key" {
  value     = aws_iam_access_key.s3.id
  sensitive = true
}

output "s3_secret_key" {
  value     = aws_iam_access_key.s3.secret
  sensitive = true
}

output "vpc_id" {
  value = aws_vpc.main.id
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "host_security_group_id" {
  value = aws_security_group.host.id
}

output "gateway_node_ports" {
  value = var.gateway_node_ports
}

output "host_instance_id" {
  value = aws_instance.host.id
}

output "host_public_ip" {
  value = aws_instance.host.public_ip
}

output "webui_url" {
  value = "http://${aws_instance.host.public_ip}:3000"
}

output "webui_admin_email" {
  value = var.webui_admin_email
}

output "webui_admin_password" {
  value     = random_password.webui_admin.result
  sensitive = true
}
