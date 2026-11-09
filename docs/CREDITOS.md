# Créditos e licenças

## Assets de arte e som

Na Fase 1, **nenhum asset de terceiros** (modelos, texturas, sons, fontes) foi incluído. Toda a arte e todo o som são originais, gerados por código neste repositório:

| Item | Origem |
|---|---|
| Pistola "Corvo SA-12", operador, braços de 1ª pessoa | Geometria procedural original (`client/src/weapons`, `client/src/characters`) |
| Texturas do mapa e da empunhadura | Canvas procedural original (`client/src/assets/proceduralTextures.ts`) |
| Sons | Síntese Web Audio original (`client/src/audio/AudioSystem.ts`) |
| Logotipo e ilustração do menu | SVG original (`client/src/ui`) |
| Mapa de ambiente para reflexos | `RoomEnvironment` do próprio Three.js (gerado em tempo de execução, MIT) |

Nomes de armas, mapas e equipes são originais e não usam marcas nem modelos reais.
Fontes: só as do sistema (pilha CSS); nenhum arquivo de fonte é distribuído.

Quando um asset CC0 for adicionado, registre aqui: nome, autor, URL, licença e data em que a licença foi conferida.

## Bibliotecas (dependências npm)

| Pacote | Licença |
|---|---|
| three | MIT |
| socket.io / socket.io-client | MIT |
| fastify, @fastify/static | MIT |
| zod | MIT |
| vite, vitest | MIT |
| tsx, typescript | MIT / Apache-2.0 |
| playwright-core | Apache-2.0 |
| concurrently | MIT |
