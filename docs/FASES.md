# Fases

| Fase | Status | Estimativa (sessões) |
|---|---|---|
| 1 — Multiplayer funcional | **Entregue (aguardando autorização)** | 1 |
| 2 — Arsenal e combate | Planejada | 2–3 |
| 3 — Skins e inventário (PostgreSQL) | Planejada | 2 |
| 4 — Personagens e animações | Planejada (depende de modelos com rig) | 2–3 |
| 5 — Bots e identificação | Planejada | 2 |
| 6 — Mapas e modos | Planejada | 3 |
| 7 — Sistemas competitivos e sociais | Planejada | 2–3 |
| 8 — Polimento | Planejada | 2 |

## Fase 1 — critérios

| Critério | Situação |
|---|---|
| Dois navegadores na mesma sala pela internet | Testado com 2 navegadores reais na **mesma máquina** (código e link de convite). Teste entre computadores diferentes pela internet: **não feito** neste ambiente (ver README, "Jogar pela internet"). |
| 150 ms de latência: movimento suave e tiros justos | Teste automatizado: 25/25 acertos com compensação vs 3/25 sem. Teste de 5 min com 2 navegadores a 150 ms: ver o relatório da fase. |
| Cliente modificado ignorado | Testes automatizados: posição falsa, eventos inventados, speedhack e cadência. |
| Reconexão devolve à partida | Testes headless e com navegador (rede derrubada por 8 s). |
| 5 minutos sem erros de console | Teste de estabilidade com 2 navegadores (ver o relatório). |
| Testes automatizados | Unitários (movimento, armas, hitboxes, validação, limite de taxa, rewind) + integração com 2 clientes headless + e2e com 2 navegadores. |
