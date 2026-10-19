"""Mesure l'agent sur une série de questions (à lancer DANS le pod de l'assistant, voir le guide section 4.4).
Compare deux versions : nombre d'appels au modèle, tokens lus, durée, outils choisis, réponse. Le modèle est
d'abord chauffé (première question non comptée) pour ne pas mesurer le chargement. Les durées dépendent du CPU
(6,9 à 8,8 tokens/s générés selon les jours) : le nombre d'appels et de tokens lus est plus fiable que les secondes."""
import json
import time

import httpx

QUESTIONS = [
    "Quels sont les 3 pods qui consomment le plus de mémoire ?",
    "Quel namespace consomme le plus de mémoire ?",
    "Combien de cibles sont actuellement up ?",
    "Quelle est la consommation mémoire du pod grafana ?",
    "Des requêtes ont-elles échoué dans Mimir ces 30 dernières minutes ?",
]


def ask(q):
    t = time.time()
    r = httpx.post("http://localhost:8000/ask", json={"question": q}, timeout=900).json()
    return r, time.time() - t


print("Chauffe du modèle (non comptée)...", flush=True)
ask(QUESTIONS[2])
tot_s = tot_tok = tot_calls = 0
for q in QUESTIONS:
    r, wall = ask(q)
    llm = r["llm_calls"]
    s = sum(c["total_s"] for c in llm)
    tok = sum(c["prompt_tokens"] or 0 for c in llm)
    tot_s += s; tot_tok += tok; tot_calls += len(llm)
    outils = ", ".join(f'{c["tool"]}({json.dumps(c["args"], ensure_ascii=False)[:110]})' for c in r["tool_calls"])
    print(f"\nQ : {q}\n  agent : {s:.1f} s en {len(llm)} appels, {tok} tokens lus (mur : {wall:.1f} s)"
          f"\n  outils : {outils}\n  réponse : {r['answer'][:300]!r}", flush=True)
print(f"\nTOTAL : {tot_s:.1f} s, {tot_calls} appels, {tot_tok} tokens lus")
