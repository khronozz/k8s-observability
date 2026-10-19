terraform {
  required_version = ">= 1.5"

  required_providers {
    helm = {
      source = "hashicorp/helm"
      # Série 2.x : la configuration du provider utilise un bloc `kubernetes { }`.
      # La série 3.x change cette syntaxe (non vérifié ici) : ne pas monter de version sans adapter envs/*/main.tf.
      version = "~> 2.17"
    }
  }
}
