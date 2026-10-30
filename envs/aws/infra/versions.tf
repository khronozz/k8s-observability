terraform {
  required_version = ">= 1.5.7"
  required_providers {
    # >= 6.59 : exigé par le module EKS 21.25.0 (versions.tf lu le 23.10.2026).
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.59, < 7"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "aws" {
  region = var.region

  # Étiquettes posées sur toutes les ressources qui en acceptent (convention du 23.10.2026).
  # Elles servent à retrouver et auditer ce qui appartient au projet (scripts/aws-audit.sh).
  default_tags {
    tags = {
      Project   = "P5-monitoring-k8s-ai"
      Group     = "13"
      Course    = "CSS-HES-SO"
      Owner     = "nicolas-favre"
      ManagedBy = "OpenTofu"
    }
  }
}
