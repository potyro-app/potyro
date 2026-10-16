# 21 — Glossary: Potyro's own words in six languages

Potyro's UI is written in English and translated into Brazilian Portuguese, German, Spanish, Polish
and Italian (#297). The translations in `packages/i18n/locales/*/messages.po` are **model drafts**
(owner decision): the language picker marks every language but English "(draft)", and a person
fluent in the language should review them before the mark comes off (`LOCALE_INFO[…].draft` in
`packages/i18n/src/locale.ts`).

This page is the contract a translator (a person or a model) keeps, so a word means the same thing
on every screen. When a message needs one of these words, use the form here. When you change one,
change it in every message of that language, not only the one you are looking at.

## How the drafts are written

- **For people who do not code.** Natural, product-quality wording; not word for word. Where the UI
  is tight (buttons, tabs, chips, calendar heads), short wins.
- **Address the person informally**: German *du*, Polish *ty*, Spanish *tú*, Italian *tu*,
  Brazilian Portuguese *você*. Potyro talks like a helpful person, not a bank.
- **No agreement with an app's own nouns** (docs/20 Q3). The shell cannot know whether an app's
  "Item" is masculine, feminine or neuter in Polish, so templates around an app's word put a colon
  after a verb and the noun after it: "Add: {noun}" is "Dodaj: {noun}", never "Nowy {noun}". The
  same for "Edit: {noun}", "Remove: {noun}", "{label}: choose" and the scope picker's
  "{scopeLabel}: …".
- **Placeholders, tags and ICU stay as they are.** `{name}`, `<0>…</0>` and `#` are never
  translated or dropped; plurals have the language's own categories (Polish one/few/many/other, the
  others one/other, plus any `=0`/`=1` the English has); a `select` keeps every arm.
  `packages/i18n/test/translations.test.ts` fails otherwise.
- **Apostrophes before a placeholder.** In ICU an ASCII `'` directly before `{` or `#` starts a
  quoted literal and swallows the placeholder. Italian writes the typographic `’` (`dell’app`), which
  is also the correct glyph.
- **Quotation marks** follow the language: German „…“, Polish „…”, the others “…”.
- **Names stay names**: Potyro, Studio, Ask, OpenRouter, Anthropic, Claude, Chrome, WebGPU,
  IndexedDB, `claude -p`, `defineApp`, `.app.ts`, `lock.json`, `seed.json`.
- **“Me” stays “Me”.** It is the name a fresh identity is stored and synced with
  (`DEFAULT_NAME` in packages/identity), so other people see exactly that word; the messages that
  mention it quote it untranslated.
- **Model-facing text is not in the catalogs** (#297 keeps it English). The few fragments that come
  from the model or the generator and are shown inside a translated message (`{lost}`, `{loss}`,
  some `{why}`/`{reason}`/`{detail}`) stay English for now; the translations are worded so an
  English fragment after a colon still reads.

## Fixed terms

| English | pt-BR | de | es | pl | it |
|---|---|---|---|---|---|
| Potyro | Potyro | Potyro | Potyro | Potyro | Potyro |
| Studio (where apps are made by talking) | Studio | Studio | Studio | Studio | Studio |
| Ask (adds records with AI; a name) | Ask | Ask | Ask | Ask | Ask |
| app | app (o) | App (die) | app (la) | aplikacja | app (l’, f.) |
| record | registro | Eintrag | registro | wpis | voce |
| page | página | Seite | página | strona | pagina |
| field | campo | Feld | campo | pole | campo |
| sealed box (where others' apps run) | caixa lacrada | versiegelte Box | caja sellada | zamknięte pudełko | scatola sigillata |
| sandbox | ambiente isolado | Sandbox | entorno aislado | piaskownica | ambiente isolato |
| run it as yours / let it run as yours | rodar como seu / deixar rodar como seu | als deine eigene laufen lassen | ejecutar como tuya / dejar que se ejecute como tuya | uruchamiać jako własną | eseguire come tua / lasciarla eseguire come tua |
| trusted | confiável | vertrauenswürdig | de confianza | zaufana | attendibile |
| draft (an unreviewed translation) | rascunho | Entwurf | borrador | wersja robocza | bozza |
| space (what a shared app's people are invited into) | espaço | Bereich | espacio | przestrzeń | spazio |
| Add: {noun} | Adicionar: {noun} | Hinzufügen: {noun} | Añadir: {noun} | Dodaj: {noun} | Aggiungi: {noun} |
| Edit: {noun} | Editar: {noun} | Bearbeiten: {noun} | Editar: {noun} | Edytuj: {noun} | Modifica: {noun} |
| New app | Novo app | Neue App | Nueva app | Nowa aplikacja | Nuova app |
| sync / synced | sincronização / sincronizado | Synchronisierung / synchronisiert | sincronización / sincronizado | synchronizacja / zsynchronizowana | sincronizzazione / sincronizzata |
| relay | relay | Relay | relay | przekaźnik | relay |
| live connection (ctx.caps.network.socket) | conexão ao vivo | Live-Verbindung | conexión en vivo | połączenie na żywo | connessione in tempo reale |
| Potyro’s rooms (the multiplayer relay) | salas do Potyro | Potyros Räume | salas de Potyro | pokoje Potyro | stanze di Potyro |
| microphone / listen (voice input, ctx.caps.speech) | microfone / ouvir | Mikrofon / zuhören | micrófono / escuchar | mikrofon / słuchać | microfono / ascoltare |
| write down (a recording, by an AI service) | transcrever | aufschreiben | transcribir | spisać | trascrivere |
| speech service (the browser's own) | serviço de voz | Sprachdienst | servicio de voz | usługa mowy | servizio vocale |
| share / shared | compartilhar / compartilhado | teilen / geteilt | compartir / compartido | udostępnić / udostępniona | condividere / condivisa |
| Make it mine (your own copy of someone's app, to change; docs/24 §6) | Tornar meu | Zu meiner machen | Hacerla mía | Przerób na swoją | Rendila mia |
| remix (noun: the copy; "Remix of Groceries by Ana") | remix | Remix | remezcla | przeróbka | remix |
| gallery (Potyro's curated apps, docs/24 §10) | galeria | Galerie | galería | galeria | galleria |
| sample records (an app's own examples, never anyone's) | registros de exemplo | Beispieleinträge | registros de ejemplo | przykładowe wpisy | voci di esempio |
| History (an app's versions) | Histórico | Verlauf | Historial | Historia | Cronologia |
| version | versão | Version | versión | wersja | versione |
| Edit mode | Modo de edição | Bearbeitungsmodus | Modo edición | Tryb edycji | Modalità modifica |
| launcher (the apps screen) | tela de apps | App-Übersicht | pantalla de apps | ekran aplikacji | schermata delle app |
| tile | bloco | Kachel | mosaico | kafelek | riquadro |
| Home screen (the launcher's style, in Look) | Tela inicial | Startbildschirm | Pantalla de inicio | Ekran główny | Schermata principale |
| Classic (the default home screen style) | Clássica | Klassisch | Clásica | Klasyczny | Classica |
| Tiles (the tile-wall home screen style, #96) | Blocos | Kacheln | Mosaicos | Kafelki | Riquadri |
| Start (the Tiles style's wall pane) | Iniciar | Start | Inicio | Start | Start |
| pin to Start / unpin | fixar no Iniciar / desafixar | an Start anheften / loslösen | anclar a Inicio / desfijar | przypnij do Startu / odepnij | aggiungi a Start / stacca |
| group (of tiles) | grupo | Gruppe | grupo | grupa | gruppo |
| Model settings | Configurações do modelo | Modelleinstellungen | Ajustes del modelo | Ustawienia modelu | Impostazioni del modello |
| engine (a model provider) | motor | Engine | motor | silnik | motore |
| API key | chave de API | API-Schlüssel | clave de API | klucz API | chiave API |
| library (code an app fetches) | biblioteca | Bibliothek | biblioteca | biblioteka | libreria |
| Fix this | Corrigir | Reparieren | Arreglar | Napraw | Correggi |
| Point at the app | Apontar para o app | Auf die App zeigen | Señalar la app | Wskaż w aplikacji | Indica nell’app |
| Look (appearance panel) | Aparência | Aussehen | Aspecto | Wygląd | Aspetto |
| You (the person's panel) | Você | Du | Tú | Ty | Tu |
| Data (every app's records) | Dados | Daten | Datos | Dane | Dati |
| Home (an app's object tiles) | Início | Start | Inicio | Start | Home |
| Objects | Objetos | Objekte | Objetos | Obiekty | Oggetti |
| source (an app's code) | código-fonte | Quelltext | código fuente | kod źródłowy | codice sorgente |
| the Potyro team | a equipe do Potyro | das Potyro-Team | el equipo de Potyro | zespół Potyro | il team di Potyro |
| words (the 24-word recovery list) | palavras | Wörter | palabras | słowa | parole |

## Short forms

Calendar column heads (Monday first in the source list): pt-BR Seg Ter Qua Qui Sex Sáb Dom;
de Mo Di Mi Do Fr Sa So; es Lu Ma Mi Ju Vi Sá Do; pl Pn Wt Śr Cz Pt So Nd; it Lu Ma Me Gi Ve Sa Do.
Hours/minutes beside a duration: pt-BR h/min, de Std./Min., es h/min, pl godz./min, it h/min.
Latitude/longitude: pt-BR lat/long, de Breite/Länge, es lat/long, pl szer./dł., it lat/long.
