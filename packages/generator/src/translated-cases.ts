// The eval's requests in Polish and Brazilian Portuguese (#301): what a person who speaks them would
// type, for every modify case and every create prompt.
//
// TEST FIXTURES, NOT MACHINE OUTPUT. Each was written by hand from the English and checked against it:
// same request, same scope, same level of vagueness, in the register a person uses on a phone (Polish
// first person in the masculine where a form is needed; Brazilian colloquial "pra", "tipo", "beleza"
// where the English is that casual). Changing one changes what the eval measures: change the English
// and its translations together, and say so in the PR.
//
// Kept as they are on purpose:
//   - code names the person quotes (`servings`, `portions`) and the button they saw ("New Place"),
//     because the app they are looking at is English and that is what it says on screen;
//   - `earlier` (what was said about earlier versions) stays English. Since #279 it reaches the model
//     as a recap, so a translated run reads an English conversation before a request in the
//     language: what it measures is whether the request is understood, and the reply's language.
// One request changes meaning: "learn Portuguese vocabulary" is "learn English vocabulary" in
// Portuguese — a Brazilian learning Portuguese is not the same request.

import type { GenPrompt } from "./backend.js";
import type { Language } from "./language.js";
import type { DefinitionShape, ModifyCase } from "./modify-corpus.js";

/** The languages the eval has hand-checked requests for. English needs none. */
export const EVAL_LANGUAGES = ["pl", "pt-BR"] as const satisfies readonly Language[];
export type EvalLanguage = (typeof EVAL_LANGUAGES)[number];

export function isEvalLanguage(x: unknown): x is EvalLanguage {
  return typeof x === "string" && (EVAL_LANGUAGES as readonly string[]).includes(x);
}

const PICK_ON_MAP = {
  pl: "Chcę, żeby kiedy mam otwartą mapę i kliknę w New Place, aplikacja poprosiła mnie o kliknięcie miejsca na mapie, a potem otworzył się formularz do dodania szczegółów miejsca ze współrzędnymi miejsca, które kliknąłem.",
  "pt-BR":
    "Eu quero que quando eu estiver com o mapa aberto e clicar em New Place, ele me peça pra clicar num lugar no mapa, e aí o formulário pra adicionar os detalhes do lugar abra com as coordenadas do lugar que eu cliquei.",
};

/** Every modify case's request (modify-corpus.ts), by case id. */
export const MODIFY_REQUESTS: Readonly<Record<EvalLanguage, Readonly<Record<string, string>>>> = {
  pl: {
    "recipes-rating": "Dodaj do każdego przepisu pole z oceną w skali 5 gwiazdek.",
    "plants-room": "Dodaj pole, w którym pokoju w domu stoi każda roślina.",
    "workout-session-notes": "Chcę móc dopisać do każdej sesji krótką notatkę, np. jak się czułem.",
    "places-website": "Dodaj do każdego miejsca link do jego strony internetowej.",
    "recipes-favourites-page": "Dodaj stronę, która pokazuje tylko przepisy oznaczone przeze mnie jako ulubione.",
    "plants-today-page": "Dodaj stronę, na której widać tylko rośliny, które trzeba dziś podlać.",
    "workout-map-page": "Dodaj stronę z mapą, która pokazuje, gdzie odbyła się każda sesja.",
    "places-pick-on-map": PICK_ON_MAP.pl,
    "recipes-rename-entity-field": "Zmień nazwę pola `servings` w przepisie na `portions` wszędzie, gdzie jest używane.",
    "workout-two-things": "Dodaj do ćwiczeń pole na notatki i stronę z ćwiczeniami, których nie robiłem przez ostatnie 30 dni.",
    "city-guide-pick-on-map": PICK_ON_MAP.pl,
    "city-guide-opening-hours": "Dodaj do każdego miejsca godziny otwarcia, jako zwykły tekst.",
    "trip-scope":
      "kiedy otwieram mapę, muszę utworzyć albo wybrać podróż. kiedy podróż jest wybrana, mapa sama otwiera się w mieście podróży, a wszystkie listy pokazują elementy z tej podróży. musi być jakiś sposób, żeby było widać, że jestem teraz w podróży X.",
    "recipes-chart": "Pokaż mi wykres, ile przepisów ugotowałem w każdym miesiącu.",
    "workout-photo-crop": "Chcę móc dołączyć zdjęcie do każdej sesji i przyciąć je przed zapisaniem.",
    "places-visit-sms": "Chcę móc zaplanować datę odwiedzin miejsca, dostać przypomnienie dzień wcześniej i wysłać adres SMS-em mojej drugiej połówce.",
    "places-distance-sort": "Posortuj listę wszystkich miejsc według odległości ode mnie.",
    "plants-no-more-pages": "Chcę widzieć tylko rośliny, które potrzebują bezpośredniego słońca.",
    "workout-rating-out-of-10": "Dobra, to teraz dodaj ocenę do każdej sesji.",
    "recipes-put-spice-back": "Zmieniłem zdanie, przywróć to z ostrością tak, jak było.",
    "plants-water-in-ml": "Dobra, to teraz chcę zapisywać, ile wody dostaje każda roślina.",
    "places-visited-starts-off": "Dobra, to teraz zrób to z odwiedzonymi, o co prosiłem.",
    "plants-scan-barcode":
      "Kiedy kupuję nową roślinę, chcę zeskanować kod kreskowy z doniczki, żeby uzupełnić jej nazwę, i zapisać numer kodu kreskowego przy roślinie.",
    "workout-heart-rate-strap":
      "Połącz się w trakcie sesji z moim paskiem do pomiaru tętna przez Bluetooth i zapisz moje średnie tętno razem z sesją.",
    "places-phone-wrong-gate": "Dodaj do każdego miejsca numer telefonu, żebym mógł zadzwonić i zarezerwować stolik.",
  },
  "pt-BR": {
    "recipes-rating": "Adicione a cada receita um campo de avaliação de 5 estrelas.",
    "plants-room": "Adicione um campo pra dizer em qual cômodo da casa cada planta fica.",
    "workout-session-notes": "Quero poder escrever uma nota curta em cada sessão, tipo como eu me senti.",
    "places-website": "Adicione um link pro site de cada lugar.",
    "recipes-favourites-page": "Adicione uma página que mostre só as receitas que eu marquei como favoritas.",
    "plants-today-page": "Adicione uma página mostrando só as plantas que precisam ser regadas hoje.",
    "workout-map-page": "Adicione uma página de mapa mostrando onde cada sessão aconteceu.",
    "places-pick-on-map": PICK_ON_MAP["pt-BR"],
    "recipes-rename-entity-field": "Renomeie o campo `servings` da receita para `portions` em todo lugar onde ele é usado.",
    "workout-two-things": "Adicione um campo de anotações aos exercícios e uma página listando os exercícios que eu não fiz nos últimos 30 dias.",
    "city-guide-pick-on-map": PICK_ON_MAP["pt-BR"],
    "city-guide-opening-hours": "Adicione o horário de funcionamento de cada lugar, como texto livre.",
    "trip-scope":
      "quando eu abro o mapa preciso criar ou selecionar uma viagem. quando uma viagem está selecionada o mapa abre automaticamente na cidade da viagem e todas as listas mostram os itens da viagem. precisamos ter um jeito de ver que eu estou na viagem X agora.",
    "recipes-chart": "Me mostra um gráfico de quantas receitas eu cozinhei em cada mês.",
    "workout-photo-crop": "Quero poder anexar uma foto a cada sessão e recortar antes de salvar.",
    "places-visit-sms": "Quero poder marcar uma data pra visitar um lugar, receber um lembrete no dia anterior e mandar o endereço por SMS pro meu parceiro.",
    "places-distance-sort": "Ordene a lista de todos os lugares pela distância até mim.",
    "plants-no-more-pages": "Quero ver só as plantas que precisam de sol direto.",
    "workout-rating-out-of-10": "Beleza, agora adicione a nota a cada sessão.",
    "recipes-put-spice-back": "Mudei de ideia, volta com aquele negócio da picância do jeito que estava.",
    "plants-water-in-ml": "Beleza, agora eu quero anotar quanta água cada planta recebe, pra eu não esquecer.",
    "places-visited-starts-off": "Beleza, agora pode fazer aquilo do visitado que eu pedi, não esquece.",
    "plants-scan-barcode":
      "Quando eu comprar uma planta nova, quero escanear o código de barras do vaso pra preencher o nome dela, e guardar o número do código de barras junto com a planta.",
    "workout-heart-rate-strap":
      "Conecta na minha cinta de frequência cardíaca Bluetooth durante a sessão e salva minha frequência cardíaca média junto com a sessão.",
    "places-phone-wrong-gate": "Adicione um número de telefone a cada lugar pra eu poder ligar e reservar uma mesa.",
  },
};

/**
 * What a `Not done:` line says in the language, beside the English patterns (modify-corpus.ts): the
 * reply is in the person's language, so "chart" comes back as "wykres". Same order as the case's
 * `notDone`; each is OR-ed with its English pattern.
 */
export const MODIFY_NOT_DONE: Readonly<Record<EvalLanguage, Readonly<Record<string, readonly string[]>>>> = {
  pl: {
    "recipes-chart": ["wykres"],
    "workout-photo-crop": ["przyci|kadr"],
    "places-visit-sms": ["sms|wiadomoś|tekst"],
    "plants-scan-barcode": ["skan|kod kreskow|kamer|aparat"],
    "workout-heart-rate-strap": ["bluetooth|pas(ek|ka|ku)|czujnik|połącz|tętn"],
  },
  "pt-BR": {
    "recipes-chart": ["gráfico|grafico"],
    "workout-photo-crop": ["recort|cortar"],
    "places-visit-sms": ["sms|mensage|texto"],
    "plants-scan-barcode": ["escane|código de barras|codigo de barras|câmera|camera"],
    "workout-heart-rate-strap": ["bluetooth|cinta|sensor|conect|frequência"],
  },
};

/** "mild, medium, hot" as a person who speaks the language would write the options back. */
const SPICE: Readonly<Record<EvalLanguage, ReadonlyArray<readonly string[]>>> = {
  pl: [
    ["łagodny", "łagodna", "łagodne", "łagodnie"],
    ["średni", "średnia", "średnie", "średnio"],
    ["ostry", "ostra", "ostre", "bardzo ostre", "pikantne", "pikantny"],
  ],
  "pt-BR": [
    ["suave", "leve", "fraca", "fraco"],
    ["médio", "média", "medio", "media"],
    ["picante", "forte", "apimentado", "apimentada", "ardido", "ardida"],
  ],
};

/** A case's own `landed`, widened where it checks words the person's language writes differently. */
function localLanded(c: ModifyCase, language: EvalLanguage): ModifyCase["landed"] {
  if (c.id !== "recipes-put-spice-back" || !c.landed) return c.landed;
  const english = c.landed;
  const words = SPICE[language];
  return (d: DefinitionShape, before: DefinitionShape) =>
    english(d, before) ||
    Object.values(d.entities.recipe?.fields ?? {}).some((f) => {
      const { type, options } = f as { type?: string; options?: unknown };
      if (type !== "enum" || !Array.isArray(options)) return false;
      const said = options.map((o) => String(o).toLowerCase());
      return words.every((forms) => forms.some((w) => said.includes(w)));
    });
}

/** The case as a person who speaks `language` asks it. Throws when a case has no translation. */
export function localizeModifyCase(c: ModifyCase, language: EvalLanguage): ModifyCase {
  const instruction = MODIFY_REQUESTS[language][c.id];
  if (!instruction) throw new Error(`modify case "${c.id}" has no ${language} request in translated-cases.ts`);
  const local = MODIFY_NOT_DONE[language][c.id];
  if (c.notDone && (!local || local.length !== c.notDone.length)) throw new Error(`modify case "${c.id}" has no ${language} Not done patterns in translated-cases.ts`);
  const landed = localLanded(c, language);
  return {
    ...c,
    instruction,
    ...(landed ? { landed } : {}),
    ...(c.notDone ? { notDone: c.notDone.map((re, i) => `${re}|${local![i]}`) } : {}),
  };
}

/** Every create prompt's request — the wild corpus (wild-prompts.ts) and the core one (prompts.ts) — by id. */
export const CREATE_REQUESTS: Readonly<Record<EvalLanguage, Readonly<Record<string, string>>>> = {
  pl: {
    // --- wild ---
    "car-maintenance":
      "Chcę śledzić serwis auta — wymiany oleju, rotację opon, takie rzeczy. Chcę widzieć, kiedy ostatnio robiłem każdą z nich, i dostawać info, kiedy coś trzeba zrobić, na podstawie przebiegu, a nie dat.",
    "last-did":
      "Coś, żeby pamiętać, kiedy ostatnio coś zrobiłem — dzwoniłem do mamy, podlewałem rośliny, wymieniałem filtr do wody, odkamieniałem czajnik. Chcę po prostu stuknąć w daną rzecz i żeby zapisała się dzisiejsza data.",
    "subscriptions-trials":
      "Śledź wszystkie moje subskrypcje, żebym widział, ile naprawdę płacę miesięcznie i rocznie, i ostrzeż mnie, zanim darmowy okres próbny zamieni się w płatny.",
    meds: "Przypominaj mi o lekach dwa razy dziennie, rano i wieczorem, i daj mi odhaczyć każdą dawkę, żebym mógł potem sprawdzić, czy jakąś pominąłem.",
    "baby-log":
      "Śledź karmienia, pieluchy i sen mojego noworodka. Zapisywanie musi być szybkie, bo robię to jedną ręką o 3 w nocy, a najważniejsze, co muszę widzieć na ekranie, to ile czasu minęło od ostatniego karmienia.",
    "mood-chart":
      "Dziennik nastroju — oceniam dzień w skali do 10 i piszę kilka zdań. Chcę widzieć wykres z ostatniego miesiąca, żeby wyłapać, co się powtarza.",
    "groceries-aisle":
      "Lista zakupów, która pamięta, co kupuję co tydzień, żebym mógł to dodać z powrotem jednym stuknięciem, i grupuje wszystko według alejek, żebym nie kluczył po sklepie.",
    climbing:
      "Zapisuj moje treningi wspinaczkowe — które drogi próbowałem, jaka wycena i czy ją w końcu przeszedłem, czy nie. Chciałbym widzieć moje najtrudniejsze przejście w tym miesiącu.",
    "freelance-hours":
      "Śledź godziny, które przepracowuję dla różnych klientów, każdy z własną stawką godzinową, żebym na koniec miesiąca wiedział dokładnie, na ile wystawić każdemu fakturę.",
    "wine-notes":
      "Notatki o winach, których próbowałem — zdjęcie etykiety, ile zapłaciłem i czy kupiłbym je jeszcze raz. Chcę móc szukać po szczepie winogron.",
    "beehives":
      "Mam trzy ule. Po każdym przeglądzie chcę zapisać dla każdego ula, czy widziałem matkę, ile ramek z czerwiem, czy były roztocza i ile miodu zebrałem. Pokaż mi historię każdego ula i kiedy ostatnio go otwierałem.",
    "chore-rota":
      "Grafik obowiązków w naszym mieszkaniu: jest nas troje, pięć obowiązków, zmieniamy się co tydzień, żeby nikt nie robił tego samego dwa razy z rzędu. Pokaż, kto co robi w tym tygodniu, i daj nam odhaczać zrobione.",
    "reading-minutes":
      "Szkoła mojej córki chce 20 minut czytania dziennie. Niech zapisuje, co i jak długo czytała, pokaż sumę z tygodnia na tle celu i trzymaj listę książek, które skończyła.",
    "lent-out":
      "Kto ma moje rzeczy: pożyczam książki, narzędzia i gry planszowe i zapominam. Zapisz, co pożyczyłem, komu i kiedy, i daj oznaczyć zwrot. Pokaż, co wciąż jest na zewnątrz, od najstarszego.",
    "sourdough":
      "Dziennik mojego zakwasu: każde karmienie z rodzajem mąki i proporcją, jak urósł, i przypomnij mi, kiedy następne karmienie, na podstawie odstępu, który ustawię.",
    "home-inventory":
      "Spis rzeczy w domu do ubezpieczenia: każda rzecz ze zdjęciem, pokojem, ceną i paragonem. Chcę widzieć łączną wartość na pokój i w sumie.",
    "bird-list":
      "Lista ptaków, które widziałem w życiu: gatunek, gdzie i kiedy pierwszy raz, zdjęcie, jeśli się udało. Pokaż, ile nowych gatunków dodałem w każdym miesiącu, i daj szukać po nazwie.",
    "vocab-trainer":
      "Pomóż mi uczyć się włoskich słówek: dodaję słowo i jego znaczenie, potem przepytuj mnie z tych, których czas nadszedł, i rozkładaj powtórki coraz rzadziej za każdym razem, gdy odpowiem dobrze.",
    "fuel-log":
      "Za każdym tankowaniem chcę wpisać litry, cenę i przebieg, i widzieć spalanie na 100 km oraz ile wydałem w tym miesiącu.",
    "allotment":
      "Zaplanuj moją działkę: sześć grządek, co w każdej posadziłem i kiedy, i kiedy spodziewam się zbiorów. Pokaż, co jest do zebrania w ciągu najbliższych dwóch tygodni.",
    "job-applications":
      "Śledź moje aplikacje o pracę: firma, stanowisko, kiedy aplikowałem i na jakim jestem etapie. Szturchnij mnie, jeśli przez dwa tygodnie nie dostałem żadnej odpowiedzi.",
    "gift-ideas":
      "Miejsce, żeby notować pomysły na prezenty dla ludzi, kiedy tylko mi przyjdą do głowy, z urodzinami każdego i przypomnieniem dwa tygodnie wcześniej, żebym naprawdę zdążył coś zamówić.",
    "home-inventory":
      "Sfotografować wszystko, co mam, na potrzeby ubezpieczenia — ile zapłaciłem, kiedy kupiłem, w którym pokoju to stoi — i zsumować wartość dla każdego pokoju.",
    "meal-plan": "Zaplanuj, co jemy każdego wieczoru w tygodniu, a potem automatycznie zrób mi z przepisów listę zakupów.",
    sleep: "Zapisuj, o której idę spać i o której wstaję, i pokaż mi średnią z ostatniego tygodnia.",
    "dog-health": "Śledź wizyty mojego psa u weterynarza, szczepienia i jego wagę w czasie, i przypomnij mi, kiedy jest następne szczepienie.",
    "vocab-quiz":
      "Pomóż mi uczyć się słówek portugalskich — dodaję słowa z tłumaczeniami, a aplikacja mnie z nich odpytuje i częściej pokazuje te, które ciągle mylę.",
    "flatmate-split": "Dziel wspólne wydatki z moimi dwoma współlokatorami — kto za co zapłacił — i wylicz na koniec miesiąca, kto komu ile jest winien.",
    "water-intake": "Daj mi stuknąć w ikonkę szklanki za każdym razem, kiedy piję wodę, i pokaż, ile brakuje mi dziś do dwóch litrów. To wszystko.",
    "book-club": "Śledź, co czyta mój klub książki, kto wybrał każdą książkę, jak każdy ją ocenił w skali do pięciu i jaka jest średnia ocena.",
    "seed-planting":
      "Zapisuj, kiedy co posadziłem i na której grządce, i mniej więcej kiedy powinienem się spodziewać zbiorów. Chciałbym to widzieć w kalendarzu.",
    "podcast-queue":
      "Kolejka odcinków podcastów, które ludzie mi polecili — kto polecił, ile trwa i czy już przesłuchałem. Pokaż mi coś krótkiego, kiedy mam tylko 20 minut.",
    "houseplant-rescue":
      "Ciągle zabijam swoje rośliny. Muszę wiedzieć, którą trzeba dziś podlać, i chcę, żeby to było oczywiste w sekundzie, w której otwieram aplikację.",
    "car-boot-sale":
      "Sprzedaję różne rzeczy na pchlich targach. Muszę śledzić, za ile coś kupiłem, za ile sprzedałem i czy w ogóle na tym zarabiam.",
    // --- core ---
    todo: "Prosta lista zadań: każde zadanie ma tytuł i pole do odhaczenia, że jest zrobione; pokaż listę.",
    notes: "Aplikacja do notatek z tytułem i wielowierszową treścią; pokaż je od najnowszych.",
    books: "Śledź książki z tytułem, autorem i oceną od 0 do 5; pokaż galerię.",
    movies: "Lista filmów do obejrzenia z tytułem, rokiem, gatunkiem (enum) i polem „obejrzany”; lista przefiltrowana do nieobejrzanych.",
    contacts: "Kontakty z imieniem i nazwiskiem, e-mailem, telefonem i tagami; lista z wyszukiwaniem.",
    expenses: "Wydatki z kwotą, kategorią (enum) i datą; wyliczana suma miesięczna.",
    habits: "Tracker nawyków: nazwa, cel na tydzień i wyliczana seria; lista pokazująca serię.",
    workouts: "Zapisuj treningi: data, rodzaj i lista serii, każda z powtórzeniami i ciężarem; widok szczegółów.",
    recipes: "Przepisy z nazwą, liczbą porcji i składnikami (nazwa + ilość); wyliczana łączna ilość.",
    plants: "Rośliny z datą ostatniego podlania i co ile dni je podlewać; wyliczana data następnego podlania i znacznik „zaległe”.",
    "plants-reminder": "Rośliny, które przypominają o podlaniu: przypomnienie zaplanowane na datę następnego podlania.",
    places: "Zapisane miejsca z nazwą i lokalizacją geo; widok mapy.",
    "places-open": "Restauracje z godzinami otwarcia i wyliczanym „otwarte teraz”; lista, którą można przefiltrować do otwartych.",
    budget: "Budżet z kategoriami, każda z limitem i wyliczanym „wydano do tej pory” z transakcji.",
    reading: "Tracker czytania: książki z liczbą stron i bieżącą stroną oraz wyliczanym procentem ukończenia.",
    inventory: "Domowy spis rzeczy: przedmioty z nazwą, ilością, miejscem i zdjęciem; galeria.",
    "tasks-due": "Zadania z terminem i priorytetem (enum); lista posortowana według terminu z formularzem „dodaj zadanie”.",
    journal: "Codzienny dziennik: wpisy z datą, nastrojem (enum) i tekstem; widok kalendarza według daty.",
    subscriptions: "Śledź subskrypcje: nazwa, miesięczny koszt, data odnowienia; wyliczana suma roczna.",
    guests: "Lista gości na wydarzenie: imię, status potwierdzenia (enum), osoby towarzyszące; wyliczana liczba osób.",
    trips: "Podróże z celem, datą początku i końca oraz wyliczaną liczbą nocy.",
    bookmarks: "Zakładki z tytułem, adresem url i tagami; lista z grupowaniem i plakietkami.",
    pantry: "Spiżarnia: składniki z ilością i wyliczanym znacznikiem „mało w zapasie”; lista przefiltrowana do tych, których jest mało.",
    "gym-prs": "Śledź rekordy osobiste dla każdego ćwiczenia, z akcją do zapisania nowego rekordu, która aktualizuje rekord.",
    "shipped-json": "Trener słówek: lista słów przychodzi razem z aplikacją jako words.json ([{ word, meaning }]); pokaż słowo, odsłoń jego znaczenie i licz słowa, które znałem.",
    "markdown-notes": "Aplikacja, która pokazuje moje notatki: wczytaj pliki .md z mojego urządzenia, wyświetl je według tytułu, pokaż jedną sformatowaną jako markdown, pozwól ją edytować i zapisać kopię z powrotem.",
  },
  "pt-BR": {
    // --- wild ---
    "car-maintenance":
      "Quero acompanhar a manutenção do meu carro — troca de óleo, rodízio de pneus, esse tipo de coisa. Quero ver quando fiz cada uma pela última vez e ser avisado quando alguma estiver vencendo, pela quilometragem e não por datas.",
    "last-did":
      "Algo pra lembrar quando foi a última vez que eu fiz as coisas — liguei pra minha mãe, reguei as plantas, troquei o filtro de água, tirei o calcário da chaleira. Eu só quero tocar na coisa e ela registrar a data de hoje.",
    "subscriptions-trials":
      "Acompanhar todas as minhas assinaturas pra eu ver quanto estou pagando de verdade por mês e por ano, e me avisar antes de um período de teste grátis virar pago.",
    meds: "Me lembra de tomar meu remédio duas vezes por dia, de manhã e à noite, e me deixa marcar cada dose pra eu poder olhar depois e ver se esqueci alguma.",
    "baby-log":
      "Acompanhar as mamadas, fraldas e o sono do meu recém-nascido. Registrar tem que ser rápido porque eu faço isso com uma mão só às 3 da manhã, e o principal que eu preciso ver na tela é quanto tempo faz desde a última mamada.",
    "mood-chart":
      "Um diário de humor — eu dou uma nota de 0 a 10 pro dia e escrevo umas duas linhas. Quero ver um gráfico do último mês pra perceber padrões.",
    "groceries-aisle":
      "Uma lista de compras que lembra o que eu compro toda semana pra eu adicionar de novo com um toque, e agrupa tudo por corredor pra eu não ficar zanzando pelo mercado.",
    climbing:
      "Registrar minhas sessões de escalada — quais vias eu tentei, o grau e se eu mandei a via ou não. Queria ver minha via mais difícil mandada neste mês.",
    "freelance-hours":
      "Acompanhar as horas que eu trabalho pra clientes diferentes, cada um com seu valor por hora, pra no fim do mês eu saber exatamente quanto cobrar de cada um.",
    "wine-notes":
      "Guardar anotações dos vinhos que eu provei — uma foto do rótulo, quanto eu paguei e se eu compraria de novo. Quero poder buscar pela uva.",
    "beehives":
      "Tenho três colmeias. Depois de cada inspeção quero anotar, por colmeia, se vi a rainha, quantos quadros de cria, se havia ácaros e o que colhi. Mostre o histórico de cada colmeia e quando a abri pela última vez.",
    "chore-rota":
      "Uma escala de tarefas para o nosso apartamento: somos três, cinco tarefas, com rodízio toda semana para ninguém repetir a mesma coisa duas vezes seguidas. Mostre quem faz o quê nesta semana e deixe a gente marcar o que foi feito.",
    "reading-minutes":
      "A escola da minha filha pede 20 minutos de leitura por dia. Deixe ela registrar o que leu e por quanto tempo, mostre o total da semana contra a meta e guarde a lista dos livros que ela terminou.",
    "lent-out":
      "Quem está com as minhas coisas: empresto livros, ferramentas e jogos de tabuleiro e esqueço. Registre o que emprestei, para quem e quando, e deixe marcar como devolvido. Mostre o que ainda está fora, do mais antigo para o mais novo.",
    "sourdough":
      "Um diário do meu fermento natural: cada alimentação com a farinha e a proporção, quanto cresceu, e me lembre de quando é a próxima alimentação com base no intervalo que eu definir.",
    "home-inventory":
      "Um inventário da casa para o seguro: cada item com foto, o cômodo, quanto paguei e a nota fiscal. Quero o valor total por cômodo e no geral.",
    "bird-list":
      "Uma lista de aves da minha vida: espécie, onde e quando vi pela primeira vez, uma foto se consegui. Mostre quantas espécies novas adicionei em cada mês e deixe buscar pelo nome.",
    "vocab-trainer":
      "Me ajude a aprender palavras em italiano: eu adiciono a palavra e o significado, depois me pergunte as que estão na hora, e espace as repetições cada vez mais quando eu acertar.",
    "fuel-log":
      "Toda vez que abasteço o carro quero anotar litros, preço e a quilometragem, e ver meu consumo por 100 km e quanto gastei neste mês.",
    "allotment":
      "Planejar minha horta: seis canteiros, o que plantei em cada um e quando, e quando espero colher. Mostre o que está para colher nas próximas duas semanas.",
    "job-applications":
      "Acompanhar minhas candidaturas a vagas: empresa, cargo, quando me candidatei e em que etapa estou. Me dá um toque se eu não tiver nenhuma resposta em duas semanas.",
    "gift-ideas":
      "Um lugar pra anotar ideias de presente pras pessoas assim que eu penso nelas, com o aniversário de todo mundo, e um lembrete duas semanas antes pra eu ter tempo de encomendar alguma coisa.",
    "home-inventory":
      "Fotografar tudo o que eu tenho pro seguro — quanto eu paguei, quando comprei, em qual cômodo está — e somar o total por cômodo.",
    "meal-plan": "Planejar o que a gente vai comer em cada noite da semana, e aí me dar a lista de compras automaticamente a partir das receitas.",
    sleep: "Registrar a que horas eu vou dormir e a que horas eu acordo, e me mostrar minha média da última semana.",
    "dog-health": "Acompanhar as consultas do meu cachorro no veterinário, as vacinas e o peso dele ao longo do tempo, e me lembrar quando for a próxima vacina.",
    "vocab-quiz":
      "Me ajuda a aprender vocabulário de inglês — eu adiciono palavras com as traduções e o app me faz perguntas, mostrando mais vezes as que eu sempre erro.",
    "flatmate-split":
      "Dividir as despesas da casa com os meus dois colegas de apartamento — quem pagou o quê — e calcular quem deve pra quem no fim do mês.",
    "water-intake": "Me deixa tocar num ícone de copo toda vez que eu bebo água e mostra quanto falta pra eu chegar a dois litros hoje. Só isso.",
    "book-club": "Acompanhar o que o meu clube do livro está lendo, quem escolheu cada livro, que nota cada um deu de 0 a 5, e a média.",
    "seed-planting":
      "Anotar quando eu plantei o quê e em qual canteiro, e mais ou menos quando eu devo esperar a colheita. Queria ver isso num calendário.",
    "podcast-queue":
      "Uma fila de episódios de podcast que as pessoas me recomendaram — quem recomendou, quanto tempo dura e se eu já ouvi. Me mostra algo curto quando eu só tenho 20 minutos.",
    "houseplant-rescue":
      "Eu vivo matando minhas plantas. Preciso saber qual precisa de água hoje, e quero que isso fique óbvio no segundo em que eu abro o app.",
    "car-boot-sale":
      "Eu vendo umas coisas em feira de usados. Preciso acompanhar por quanto eu comprei cada coisa, por quanto vendi e se no geral eu estou ganhando dinheiro de verdade.",
    // --- core ---
    todo: "Uma lista de tarefas simples: cada tarefa tem um título e uma caixinha de feito; mostre uma lista.",
    notes: "Um app de notas com título e um corpo de várias linhas; liste as mais recentes primeiro.",
    books: "Acompanhar livros com título, autor e uma nota de 0 a 5; mostre uma galeria.",
    movies: "Uma lista de filmes pra assistir com título, ano, gênero (enum) e um booleano 'assistido'; uma lista filtrada pelos não assistidos.",
    contacts: "Contatos com nome, e-mail, telefone e tags; uma lista com busca.",
    expenses: "Despesas com valor, categoria (enum) e data; um total mensal calculado.",
    habits: "Um acompanhamento de hábitos: nome, meta por semana e uma sequência calculada; uma lista mostrando a sequência.",
    workouts: "Registrar treinos: data, tipo e uma lista de séries, cada uma com repetições e carga; uma tela de detalhes.",
    recipes: "Receitas com nome, porções e ingredientes (nome + quantidade); uma quantidade total calculada.",
    plants: "Plantas com a data da última rega e o intervalo; uma próxima data de rega calculada e um indicador de 'atrasada'.",
    "plants-reminder": "Plantas que lembram você de regá-las: um lembrete agendado pra próxima data de rega.",
    places: "Lugares salvos com nome e uma localização geográfica; uma visualização de mapa.",
    "places-open": "Restaurantes com horário de funcionamento e um 'aberto agora' calculado; uma lista que dá pra filtrar pelos abertos.",
    budget: "Um orçamento com categorias, cada uma com um limite e um 'gasto até agora' calculado a partir das transações.",
    reading: "Um acompanhamento de leitura: livros com total de páginas e página atual, e uma porcentagem concluída calculada.",
    inventory: "Inventário da casa: itens com nome, quantidade, local e uma foto; uma galeria.",
    "tasks-due": "Tarefas com prazo e prioridade (enum); uma lista ordenada pelo prazo com um formulário de 'adicionar tarefa'.",
    journal: "Um diário: entradas com data, humor (enum) e texto; uma visualização de calendário por data.",
    subscriptions: "Acompanhar assinaturas: nome, custo mensal, data de renovação; um total anual calculado.",
    guests: "Uma lista de convidados de um evento: nome, status de confirmação (enum), acompanhantes; uma contagem de pessoas calculada.",
    trips: "Viagens com destino, datas de ida e volta e um número de noites calculado.",
    bookmarks: "Favoritos com título, url e tags; uma lista com cara de agrupada, com etiquetas.",
    pantry: "Uma despensa: ingredientes com quantidade e um indicador calculado de 'estoque baixo'; uma lista filtrada pelos que estão acabando.",
    "gym-prs": "Acompanhar recordes pessoais por exercício, com uma ação pra registrar um novo recorde que atualiza o recorde.",
    "shipped-json": "Um treinador de vocabulário: a lista de palavras vem com o app como words.json ([{ word, meaning }]); mostra uma palavra, revela o significado e conta as palavras que eu acertei.",
    "markdown-notes": "Um app que mostra minhas notas: trazer arquivos .md do meu aparelho, listar pelo título, ler uma renderizada como markdown, editar e salvar uma cópia de volta.",
  },
};

/** The prompt as a person who speaks `language` asks it, with the language set. Throws when it has no translation. */
export function localizeCreatePrompt<P extends GenPrompt>(p: P, language: EvalLanguage): P {
  const description = CREATE_REQUESTS[language][p.id];
  if (!description) throw new Error(`create prompt "${p.id}" has no ${language} request in translated-cases.ts`);
  return { ...p, description, language };
}
