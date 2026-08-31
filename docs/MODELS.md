# Model configuration

## RTX 5070 12 GB

Recommended starting point:

`qwen3.5:9b-q4_K_M`

This is a 9.65B-parameter multimodal model in a 6.6 GB Q4_K_M package, leaving substantial VRAM headroom for the OS, context/KV cache, and Fusion.

An 11 GB Q8 build exists, but Q4_K_M is the safer default for long agent sessions.

## Cloud escalation

Use Fireworks when the task needs more reasoning capacity.

Example:

`FIREWORKS_MODEL=accounts/fireworks/models/glm-5p2`

The provider adapter is intentionally model-agnostic. If a better Fireworks model becomes available, change the environment variable instead of changing application code.

## Strategy

Local:
- routine planning
- small CAD tasks
- document inspection
- private project context

Cloud:
- difficult design planning
- long-horizon reasoning
- code generation
- tasks where local quality is insufficient

Do not send confidential project information to cloud providers unless you are comfortable with the provider and its applicable data-handling terms.
