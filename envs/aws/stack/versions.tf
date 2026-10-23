terraform {
  required_version = ">= 1.5"
  required_providers {
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.17" # même série que envs/local (bloc `kubernetes { }`)
    }
  }
}
