# Adventure research evidence

Research batches live in `data/src/research-*.jsonl`. Their evidence lives in
`data/research-sources-*.jsonl`, matched by `country` and `place`.

`verified_at` records when the source was read and the core place/experience was
confirmed. It does not mean every mutable operating detail was independently
verified. Cost and difficulty are Wayfinder's ordinal editorial classifications;
`season`, `dog_friendly` and descriptions must stay cautious unless a current
source explicitly supports a narrower claim. Travellers must still check live
conditions, closures, permits and operator availability before setting out.

Run `python tools/check_research_sources.py` to catch missing, duplicate and
orphan source records. The check also requires a concrete rationale for each
paid discovery. That rationale should establish limited access, specialist
appeal, remoteness, small scale, or clear absence from the destination's main
visitor circuit. It cannot turn a famous attraction into paid content.

Antarctica is exclusive to the all-continents bundle and has no standalone
pack. Every `AQ` source row must set `bundle_only: true`; its hidden gems use
`pack: "all"`, while its classic entries keep `hidden_gem: false` and
`pack: null`. The source and build validators enforce this contract.
