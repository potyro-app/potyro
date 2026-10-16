// The words to draw, in the six languages the app speaks, and how a guess is checked against one.
//
// One row per thing, in the order of `LANGS`: the same concept in every language, so a room that
// changes its language mid-game draws from the same pool and a test can say "row 12 is a cat". Every
// word is a thing a child can draw and name: animals, food, toys, things at home, nature, vehicles,
// people from stories. No weapons, nothing scary beyond a friendly ghost.
//
// Checking a guess forgives what a person typing on a phone gets wrong and is not about the word:
// case, accents (ç, ü, ł, ß), a leading article ("the cat", "die Katze", "el gato"), spaces and
// hyphens ("icecream", "lecca lecca"). One letter off is "close", never "right".

export const LANGS = ["en", "pt-BR", "de", "es", "pl", "it"] as const;
export type Lang = (typeof LANGS)[number];
export const isLang = (x: unknown): x is Lang => typeof x === "string" && (LANGS as readonly string[]).includes(x);

type Row = readonly [en: string, ptBR: string, de: string, es: string, pl: string, it: string];

// prettier-ignore
const ROWS: readonly Row[] = [
  // animals
  ["cat", "gato", "Katze", "gato", "kot", "gatto"],
  ["dog", "cachorro", "Hund", "perro", "pies", "cane"],
  ["fish", "peixe", "Fisch", "pez", "ryba", "pesce"],
  ["bird", "pássaro", "Vogel", "pájaro", "ptak", "uccello"],
  ["horse", "cavalo", "Pferd", "caballo", "koń", "cavallo"],
  ["cow", "vaca", "Kuh", "vaca", "krowa", "mucca"],
  ["pig", "porco", "Schwein", "cerdo", "świnia", "maiale"],
  ["sheep", "ovelha", "Schaf", "oveja", "owca", "pecora"],
  ["duck", "pato", "Ente", "pato", "kaczka", "anatra"],
  ["chicken", "galinha", "Huhn", "gallina", "kura", "gallina"],
  ["rabbit", "coelho", "Hase", "conejo", "królik", "coniglio"],
  ["mouse", "rato", "Maus", "ratón", "mysz", "topo"],
  ["frog", "sapo", "Frosch", "rana", "żaba", "rana"],
  ["snake", "cobra", "Schlange", "serpiente", "wąż", "serpente"],
  ["turtle", "tartaruga", "Schildkröte", "tortuga", "żółw", "tartaruga"],
  ["elephant", "elefante", "Elefant", "elefante", "słoń", "elefante"],
  ["giraffe", "girafa", "Giraffe", "jirafa", "żyrafa", "giraffa"],
  ["lion", "leão", "Löwe", "león", "lew", "leone"],
  ["tiger", "tigre", "Tiger", "tigre", "tygrys", "tigre"],
  ["monkey", "macaco", "Affe", "mono", "małpa", "scimmia"],
  ["bear", "urso", "Bär", "oso", "niedźwiedź", "orso"],
  ["zebra", "zebra", "Zebra", "cebra", "zebra", "zebra"],
  ["penguin", "pinguim", "Pinguin", "pingüino", "pingwin", "pinguino"],
  ["owl", "coruja", "Eule", "búho", "sowa", "gufo"],
  ["bee", "abelha", "Biene", "abeja", "pszczoła", "ape"],
  ["butterfly", "borboleta", "Schmetterling", "mariposa", "motyl", "farfalla"],
  ["spider", "aranha", "Spinne", "araña", "pająk", "ragno"],
  ["snail", "caracol", "Schnecke", "caracol", "ślimak", "lumaca"],
  ["octopus", "polvo", "Krake", "pulpo", "ośmiornica", "polpo"],
  ["whale", "baleia", "Wal", "ballena", "wieloryb", "balena"],
  ["shark", "tubarão", "Hai", "tiburón", "rekin", "squalo"],
  ["crab", "caranguejo", "Krabbe", "cangrejo", "krab", "granchio"],
  ["dolphin", "golfinho", "Delfin", "delfín", "delfin", "delfino"],
  ["ant", "formiga", "Ameise", "hormiga", "mrówka", "formica"],
  ["crocodile", "crocodilo", "Krokodil", "cocodrilo", "krokodyl", "coccodrillo"],
  ["kangaroo", "canguru", "Känguru", "canguro", "kangur", "canguro"],
  ["camel", "camelo", "Kamel", "camello", "wielbłąd", "cammello"],
  ["fox", "raposa", "Fuchs", "zorro", "lis", "volpe"],
  ["hedgehog", "ouriço", "Igel", "erizo", "jeż", "riccio"],
  ["bat", "morcego", "Fledermaus", "murciélago", "nietoperz", "pipistrello"],
  ["worm", "minhoca", "Wurm", "gusano", "robak", "verme"],
  ["dinosaur", "dinossauro", "Dinosaurier", "dinosaurio", "dinozaur", "dinosauro"],
  ["unicorn", "unicórnio", "Einhorn", "unicornio", "jednorożec", "unicorno"],
  ["dragon", "dragão", "Drache", "dragón", "smok", "drago"],
  ["parrot", "papagaio", "Papagei", "loro", "papuga", "pappagallo"],
  ["squirrel", "esquilo", "Eichhörnchen", "ardilla", "wiewiórka", "scoiattolo"],
  ["ladybug", "joaninha", "Marienkäfer", "mariquita", "biedronka", "coccinella"],
  ["jellyfish", "água-viva", "Qualle", "medusa", "meduza", "medusa"],
  ["peacock", "pavão", "Pfau", "pavo real", "paw", "pavone"],
  ["flamingo", "flamingo", "Flamingo", "flamenco", "flaming", "fenicottero"],
  ["seal", "foca", "Robbe", "foca", "foka", "foca"],
  ["goat", "cabra", "Ziege", "cabra", "koza", "capra"],
  ["deer", "veado", "Hirsch", "ciervo", "jeleń", "cervo"],
  ["wolf", "lobo", "Wolf", "lobo", "wilk", "lupo"],
  ["panda", "panda", "Panda", "panda", "panda", "panda"],
  ["koala", "coala", "Koala", "koala", "koala", "koala"],
  ["swan", "cisne", "Schwan", "cisne", "łabędź", "cigno"],
  ["eagle", "águia", "Adler", "águila", "orzeł", "aquila"],
  ["caterpillar", "lagarta", "Raupe", "oruga", "gąsienica", "bruco"],
  ["starfish", "estrela-do-mar", "Seestern", "estrella de mar", "rozgwiazda", "stella marina"],
  ["hippo", "hipopótamo", "Nilpferd", "hipopótamo", "hipopotam", "ippopotamo"],
  // food
  ["apple", "maçã", "Apfel", "manzana", "jabłko", "mela"],
  ["banana", "banana", "Banane", "plátano", "banan", "banana"],
  ["pear", "pera", "Birne", "pera", "gruszka", "pera"],
  ["grapes", "uvas", "Trauben", "uvas", "winogrona", "uva"],
  ["strawberry", "morango", "Erdbeere", "fresa", "truskawka", "fragola"],
  ["cherry", "cereja", "Kirsche", "cereza", "wiśnia", "ciliegia"],
  ["lemon", "limão", "Zitrone", "limón", "cytryna", "limone"],
  ["orange", "laranja", "Orange", "naranja", "pomarańcza", "arancia"],
  ["watermelon", "melancia", "Wassermelone", "sandía", "arbuz", "anguria"],
  ["pineapple", "abacaxi", "Ananas", "piña", "ananas", "ananas"],
  ["carrot", "cenoura", "Karotte", "zanahoria", "marchewka", "carota"],
  ["potato", "batata", "Kartoffel", "patata", "ziemniak", "patata"],
  ["tomato", "tomate", "Tomate", "tomate", "pomidor", "pomodoro"],
  ["corn", "milho", "Mais", "maíz", "kukurydza", "mais"],
  ["mushroom", "cogumelo", "Pilz", "seta", "grzyb", "fungo"],
  ["bread", "pão", "Brot", "pan", "chleb", "pane"],
  ["cheese", "queijo", "Käse", "queso", "ser", "formaggio"],
  ["egg", "ovo", "Ei", "huevo", "jajko", "uovo"],
  ["cake", "bolo", "Kuchen", "pastel", "ciasto", "torta"],
  ["cookie", "biscoito", "Keks", "galleta", "ciastko", "biscotto"],
  ["ice cream", "sorvete", "Eis", "helado", "lody", "gelato"],
  ["pizza", "pizza", "Pizza", "pizza", "pizza", "pizza"],
  ["sandwich", "sanduíche", "Sandwich", "sándwich", "kanapka", "panino"],
  ["candy", "bala", "Bonbon", "caramelo", "cukierek", "caramella"],
  ["lollipop", "pirulito", "Lutscher", "piruleta", "lizak", "lecca-lecca"],
  ["donut", "rosquinha", "Donut", "dónut", "pączek", "ciambella"],
  ["milk", "leite", "Milch", "leche", "mleko", "latte"],
  ["honey", "mel", "Honig", "miel", "miód", "miele"],
  ["popcorn", "pipoca", "Popcorn", "palomitas", "popcorn", "popcorn"],
  ["hot dog", "cachorro-quente", "Hotdog", "perrito caliente", "hot dog", "hot dog"],
  ["soup", "sopa", "Suppe", "sopa", "zupa", "zuppa"],
  ["pancake", "panqueca", "Pfannkuchen", "tortita", "naleśnik", "frittella"],
  ["chocolate", "chocolate", "Schokolade", "chocolate", "czekolada", "cioccolato"],
  ["onion", "cebola", "Zwiebel", "cebolla", "cebula", "cipolla"],
  ["pumpkin", "abóbora", "Kürbis", "calabaza", "dynia", "zucca"],
  ["coconut", "coco", "Kokosnuss", "coco", "kokos", "cocco"],
  ["hamburger", "hambúrguer", "Hamburger", "hamburguesa", "hamburger", "hamburger"],
  ["french fries", "batata frita", "Pommes", "patatas fritas", "frytki", "patatine"],
  ["spaghetti", "espaguete", "Spaghetti", "espaguetis", "spaghetti", "spaghetti"],
  ["muffin", "bolinho", "Muffin", "magdalena", "babeczka", "tortino"],
  ["broccoli", "brócolis", "Brokkoli", "brócoli", "brokuły", "broccoli"],
  ["cucumber", "pepino", "Gurke", "pepino", "ogórek", "cetriolo"],
  // at home
  ["house", "casa", "Haus", "casa", "dom", "casa"],
  ["door", "porta", "Tür", "puerta", "drzwi", "porta"],
  ["window", "janela", "Fenster", "ventana", "okno", "finestra"],
  ["chair", "cadeira", "Stuhl", "silla", "krzesło", "sedia"],
  ["table", "mesa", "Tisch", "mesa", "stół", "tavolo"],
  ["bed", "cama", "Bett", "cama", "łóżko", "letto"],
  ["lamp", "abajur", "Lampe", "lámpara", "lampa", "lampada"],
  ["clock", "relógio", "Uhr", "reloj", "zegar", "orologio"],
  ["key", "chave", "Schlüssel", "llave", "klucz", "chiave"],
  ["book", "livro", "Buch", "libro", "książka", "libro"],
  ["pencil", "lápis", "Bleistift", "lápiz", "ołówek", "matita"],
  ["scissors", "tesoura", "Schere", "tijeras", "nożyczki", "forbici"],
  ["cup", "xícara", "Tasse", "taza", "kubek", "tazza"],
  ["spoon", "colher", "Löffel", "cuchara", "łyżka", "cucchiaio"],
  ["fork", "garfo", "Gabel", "tenedor", "widelec", "forchetta"],
  ["plate", "prato", "Teller", "plato", "talerz", "piatto"],
  ["bottle", "garrafa", "Flasche", "botella", "butelka", "bottiglia"],
  ["umbrella", "guarda-chuva", "Regenschirm", "paraguas", "parasol", "ombrello"],
  ["glasses", "óculos", "Brille", "gafas", "okulary", "occhiali"],
  ["hat", "chapéu", "Hut", "sombrero", "kapelusz", "cappello"],
  ["shoe", "sapato", "Schuh", "zapato", "but", "scarpa"],
  ["sock", "meia", "Socke", "calcetín", "skarpetka", "calzino"],
  ["shirt", "camisa", "Hemd", "camisa", "koszula", "camicia"],
  ["dress", "vestido", "Kleid", "vestido", "sukienka", "vestito"],
  ["crown", "coroa", "Krone", "corona", "korona", "corona"],
  ["ring", "anel", "Ring", "anillo", "pierścionek", "anello"],
  ["bag", "bolsa", "Tasche", "bolso", "torba", "borsa"],
  ["balloon", "balão", "Luftballon", "globo", "balon", "palloncino"],
  ["ball", "bola", "Ball", "pelota", "piłka", "palla"],
  ["kite", "pipa", "Drachen", "cometa", "latawiec", "aquilone"],
  ["drum", "tambor", "Trommel", "tambor", "bęben", "tamburo"],
  ["guitar", "violão", "Gitarre", "guitarra", "gitara", "chitarra"],
  ["piano", "piano", "Klavier", "piano", "pianino", "pianoforte"],
  ["trumpet", "trompete", "Trompete", "trompeta", "trąbka", "tromba"],
  ["bell", "sino", "Glocke", "campana", "dzwon", "campana"],
  ["candle", "vela", "Kerze", "vela", "świeca", "candela"],
  ["gift", "presente", "Geschenk", "regalo", "prezent", "regalo"],
  ["toothbrush", "escova de dentes", "Zahnbürste", "cepillo de dientes", "szczoteczka", "spazzolino"],
  ["comb", "pente", "Kamm", "peine", "grzebień", "pettine"],
  ["mirror", "espelho", "Spiegel", "espejo", "lustro", "specchio"],
  ["phone", "telefone", "Telefon", "teléfono", "telefon", "telefono"],
  ["computer", "computador", "Computer", "ordenador", "komputer", "computer"],
  ["television", "televisão", "Fernseher", "televisión", "telewizor", "televisione"],
  ["camera", "câmera", "Kamera", "cámara", "aparat", "fotocamera"],
  ["robot", "robô", "Roboter", "robot", "robot", "robot"],
  ["teddy bear", "ursinho", "Teddybär", "osito de peluche", "miś", "orsacchiotto"],
  ["doll", "boneca", "Puppe", "muñeca", "lalka", "bambola"],
  ["envelope", "envelope", "Umschlag", "sobre", "koperta", "busta"],
  ["ladder", "escada", "Leiter", "escalera", "drabina", "scala"],
  ["hammer", "martelo", "Hammer", "martillo", "młotek", "martello"],
  ["bucket", "balde", "Eimer", "cubo", "wiadro", "secchio"],
  ["broom", "vassoura", "Besen", "escoba", "miotła", "scopa"],
  ["tent", "barraca", "Zelt", "tienda", "namiot", "tenda"],
  ["flag", "bandeira", "Fahne", "bandera", "flaga", "bandiera"],
  ["map", "mapa", "Karte", "mapa", "mapa", "mappa"],
  ["magnet", "ímã", "Magnet", "imán", "magnes", "calamita"],
  ["light bulb", "lâmpada", "Glühbirne", "bombilla", "żarówka", "lampadina"],
  ["pillow", "travesseiro", "Kissen", "almohada", "poduszka", "cuscino"],
  ["bathtub", "banheira", "Badewanne", "bañera", "wanna", "vasca"],
  ["backpack", "mochila", "Rucksack", "mochila", "plecak", "zaino"],
  ["basket", "cesta", "Korb", "cesta", "koszyk", "cestino"],
  ["paintbrush", "pincel", "Pinsel", "pincel", "pędzel", "pennello"],
  ["glove", "luva", "Handschuh", "guante", "rękawiczka", "guanto"],
  ["scarf", "cachecol", "Schal", "bufanda", "szalik", "sciarpa"],
  ["button", "botão", "Knopf", "botón", "guzik", "bottone"],
  ["treasure", "tesouro", "Schatz", "tesoro", "skarb", "tesoro"],
  ["anchor", "âncora", "Anker", "ancla", "kotwica", "ancora"],
  ["flashlight", "lanterna", "Taschenlampe", "linterna", "latarka", "torcia"],
  ["telescope", "telescópio", "Teleskop", "telescopio", "teleskop", "telescopio"],
  ["tie", "gravata", "Krawatte", "corbata", "krawat", "cravatta"],
  ["mask", "máscara", "Maske", "máscara", "maska", "maschera"],
  ["coin", "moeda", "Münze", "moneda", "moneta", "moneta"],
  ["piggy bank", "cofrinho", "Sparschwein", "hucha", "skarbonka", "salvadanaio"],
  ["fridge", "geladeira", "Kühlschrank", "nevera", "lodówka", "frigorifero"],
  ["sofa", "sofá", "Sofa", "sofá", "kanapa", "divano"],
  ["shower", "chuveiro", "Dusche", "ducha", "prysznic", "doccia"],
  ["towel", "toalha", "Handtuch", "toalla", "ręcznik", "asciugamano"],
  ["soap", "sabão", "Seife", "jabón", "mydło", "sapone"],
  ["roof", "telhado", "Dach", "tejado", "dach", "tetto"],
  ["headphones", "fones de ouvido", "Kopfhörer", "auriculares", "słuchawki", "cuffie"],
  ["microphone", "microfone", "Mikrofon", "micrófono", "mikrofon", "microfono"],
  ["dice", "dado", "Würfel", "dado", "kostka", "dado"],
  ["puzzle", "quebra-cabeça", "Puzzle", "rompecabezas", "puzzle", "puzzle"],
  ["trophy", "troféu", "Pokal", "trofeo", "puchar", "trofeo"],
  ["medal", "medalha", "Medaille", "medalla", "medal", "medaglia"],
  ["yo-yo", "ioiô", "Jo-Jo", "yoyó", "jojo", "yo-yo"],
  // nature
  ["sun", "sol", "Sonne", "sol", "słońce", "sole"],
  ["moon", "lua", "Mond", "luna", "księżyc", "luna"],
  ["star", "estrela", "Stern", "estrella", "gwiazda", "stella"],
  ["cloud", "nuvem", "Wolke", "nube", "chmura", "nuvola"],
  ["rain", "chuva", "Regen", "lluvia", "deszcz", "pioggia"],
  ["snow", "neve", "Schnee", "nieve", "śnieg", "neve"],
  ["rainbow", "arco-íris", "Regenbogen", "arcoíris", "tęcza", "arcobaleno"],
  ["lightning", "raio", "Blitz", "rayo", "błyskawica", "fulmine"],
  ["tree", "árvore", "Baum", "árbol", "drzewo", "albero"],
  ["flower", "flor", "Blume", "flor", "kwiat", "fiore"],
  ["leaf", "folha", "Blatt", "hoja", "liść", "foglia"],
  ["grass", "grama", "Gras", "hierba", "trawa", "erba"],
  ["mountain", "montanha", "Berg", "montaña", "góra", "montagna"],
  ["volcano", "vulcão", "Vulkan", "volcán", "wulkan", "vulcano"],
  ["island", "ilha", "Insel", "isla", "wyspa", "isola"],
  ["river", "rio", "Fluss", "río", "rzeka", "fiume"],
  ["beach", "praia", "Strand", "playa", "plaża", "spiaggia"],
  ["wave", "onda", "Welle", "ola", "fala", "onda"],
  ["fire", "fogo", "Feuer", "fuego", "ogień", "fuoco"],
  ["rock", "pedra", "Stein", "piedra", "kamień", "sasso"],
  ["cactus", "cacto", "Kaktus", "cactus", "kaktus", "cactus"],
  ["palm tree", "palmeira", "Palme", "palmera", "palma", "palma"],
  ["sunflower", "girassol", "Sonnenblume", "girasol", "słonecznik", "girasole"],
  ["rose", "rosa", "Rose", "rosa", "róża", "rosa"],
  ["snowman", "boneco de neve", "Schneemann", "muñeco de nieve", "bałwan", "pupazzo di neve"],
  ["snowflake", "floco de neve", "Schneeflocke", "copo de nieve", "płatek śniegu", "fiocco di neve"],
  ["planet", "planeta", "Planet", "planeta", "planeta", "pianeta"],
  ["desert", "deserto", "Wüste", "desierto", "pustynia", "deserto"],
  ["forest", "floresta", "Wald", "bosque", "las", "bosco"],
  ["cave", "caverna", "Höhle", "cueva", "jaskinia", "grotta"],
  ["shell", "concha", "Muschel", "concha", "muszla", "conchiglia"],
  ["nest", "ninho", "Nest", "nido", "gniazdo", "nido"],
  ["feather", "pena", "Feder", "pluma", "pióro", "piuma"],
  ["bone", "osso", "Knochen", "hueso", "kość", "osso"],
  ["spiderweb", "teia", "Spinnennetz", "telaraña", "pajęczyna", "ragnatela"],
  ["tornado", "tornado", "Tornado", "tornado", "tornado", "tornado"],
  ["sandcastle", "castelo de areia", "Sandburg", "castillo de arena", "zamek z piasku", "castello di sabbia"],
  // on the move
  ["car", "carro", "Auto", "coche", "samochód", "macchina"],
  ["bus", "ônibus", "Bus", "autobús", "autobus", "autobus"],
  ["train", "trem", "Zug", "tren", "pociąg", "treno"],
  ["airplane", "avião", "Flugzeug", "avión", "samolot", "aereo"],
  ["boat", "barco", "Boot", "barco", "łódź", "barca"],
  ["bicycle", "bicicleta", "Fahrrad", "bicicleta", "rower", "bicicletta"],
  ["motorcycle", "moto", "Motorrad", "moto", "motocykl", "moto"],
  ["rocket", "foguete", "Rakete", "cohete", "rakieta", "razzo"],
  ["helicopter", "helicóptero", "Hubschrauber", "helicóptero", "helikopter", "elicottero"],
  ["truck", "caminhão", "Lastwagen", "camión", "ciężarówka", "camion"],
  ["tractor", "trator", "Traktor", "tractor", "traktor", "trattore"],
  ["submarine", "submarino", "U-Boot", "submarino", "łódź podwodna", "sottomarino"],
  ["skateboard", "skate", "Skateboard", "monopatín", "deskorolka", "skateboard"],
  ["sled", "trenó", "Schlitten", "trineo", "sanki", "slitta"],
  ["fire truck", "caminhão de bombeiros", "Feuerwehrauto", "camión de bomberos", "wóz strażacki", "camion dei pompieri"],
  ["ambulance", "ambulância", "Krankenwagen", "ambulancia", "karetka", "ambulanza"],
  ["wheel", "roda", "Rad", "rueda", "koło", "ruota"],
  // you and me
  ["eye", "olho", "Auge", "ojo", "oko", "occhio"],
  ["nose", "nariz", "Nase", "nariz", "nos", "naso"],
  ["mouth", "boca", "Mund", "boca", "usta", "bocca"],
  ["ear", "orelha", "Ohr", "oreja", "ucho", "orecchio"],
  ["hand", "mão", "Hand", "mano", "ręka", "mano"],
  ["foot", "pé", "Fuß", "pie", "stopa", "piede"],
  ["tooth", "dente", "Zahn", "diente", "ząb", "dente"],
  ["heart", "coração", "Herz", "corazón", "serce", "cuore"],
  ["smile", "sorriso", "Lächeln", "sonrisa", "uśmiech", "sorriso"],
  ["beard", "barba", "Bart", "barba", "broda", "barba"],
  // places
  ["castle", "castelo", "Burg", "castillo", "zamek", "castello"],
  ["bridge", "ponte", "Brücke", "puente", "most", "ponte"],
  ["lighthouse", "farol", "Leuchtturm", "faro", "latarnia", "faro"],
  ["school", "escola", "Schule", "escuela", "szkoła", "scuola"],
  ["igloo", "iglu", "Iglu", "iglú", "igloo", "igloo"],
  ["pyramid", "pirâmide", "Pyramide", "pirámide", "piramida", "piramide"],
  ["windmill", "moinho", "Windmühle", "molino", "wiatrak", "mulino"],
  ["fence", "cerca", "Zaun", "valla", "płot", "recinto"],
  ["swing", "balanço", "Schaukel", "columpio", "huśtawka", "altalena"],
  ["garden", "jardim", "Garten", "jardín", "ogród", "giardino"],
  ["farm", "fazenda", "Bauernhof", "granja", "farma", "fattoria"],
  ["zoo", "zoológico", "Zoo", "zoo", "zoo", "zoo"],
  // people from stories
  ["ghost", "fantasma", "Gespenst", "fantasma", "duch", "fantasma"],
  ["witch", "bruxa", "Hexe", "bruja", "czarownica", "strega"],
  ["pirate", "pirata", "Pirat", "pirata", "pirat", "pirata"],
  ["king", "rei", "König", "rey", "król", "re"],
  ["queen", "rainha", "Königin", "reina", "królowa", "regina"],
  ["princess", "princesa", "Prinzessin", "princesa", "księżniczka", "principessa"],
  ["clown", "palhaço", "Clown", "payaso", "klaun", "pagliaccio"],
  ["astronaut", "astronauta", "Astronaut", "astronauta", "astronauta", "astronauta"],
  ["wizard", "mago", "Zauberer", "mago", "czarodziej", "mago"],
  ["alien", "alienígena", "Außerirdischer", "extraterrestre", "kosmita", "alieno"],
  ["mermaid", "sereia", "Meerjungfrau", "sirena", "syrenka", "sirena"],
  ["angel", "anjo", "Engel", "ángel", "anioł", "angelo"],
  ["superhero", "super-herói", "Superheld", "superhéroe", "superbohater", "supereroe"],
  ["cook", "cozinheiro", "Koch", "cocinero", "kucharz", "cuoco"],
  ["doctor", "médico", "Arzt", "médico", "lekarz", "medico"],
  ["monster", "monstro", "Monster", "monstruo", "potwór", "mostro"],
];

const COLUMN: Record<Lang, number> = { en: 0, "pt-BR": 1, de: 2, es: 3, pl: 4, it: 5 };

/** How many things there are to draw (the same in every language). */
export const WORD_COUNT = ROWS.length;

/** Thing number `i` in `lang`. */
export function wordAt(lang: Lang, i: number): string {
  const row = ROWS[i];
  if (!row) throw new RangeError(`no word ${i}`);
  return row[COLUMN[lang]];
}

/** Every word in `lang`, in row order. */
export const wordsIn = (lang: Lang): string[] => ROWS.map((r) => r[COLUMN[lang]]);

/**
 * `count` different things for the drawer to choose from, none of them in `used` (the ones drawn
 * already this game), picked with `random` (0 ≤ x < 1). When the pool runs dry, `used` is forgotten:
 * a long game repeats rather than stops.
 */
export function chooseWords(count: number, used: readonly number[], random: () => number): number[] {
  const seen = new Set(used);
  let pool = ROWS.map((_, i) => i).filter((i) => !seen.has(i));
  if (pool.length < count) pool = ROWS.map((_, i) => i);
  const out: number[] = [];
  while (out.length < count && pool.length) {
    const k = Math.min(pool.length - 1, Math.floor(random() * pool.length));
    out.push(pool[k]!);
    pool = [...pool.slice(0, k), ...pool.slice(k + 1)];
  }
  return out;
}

// ---- checking a guess ----

/** Articles a person may type before the word ("the cat"), per language. */
const ARTICLES: Record<Lang, readonly string[]> = {
  en: ["the", "a", "an"],
  "pt-BR": ["o", "a", "os", "as", "um", "uma"],
  de: ["der", "die", "das", "ein", "eine", "einen"],
  es: ["el", "la", "los", "las", "un", "una"],
  pl: [],
  it: ["il", "lo", "la", "i", "gli", "le", "un", "uno", "una", "l"],
};

/**
 * A word or a guess reduced to what matters: lower case, accents and ł/ß spelled out plainly,
 * apostrophes and hyphens as spaces, anything else that is not a letter or a digit dropped, one
 * leading article dropped, and the spaces too ("ice cream" and "icecream" are the same guess).
 */
export function normalize(text: string, lang: Lang): string {
  const plain = text
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['’`\-_]/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (plain.length > 1 && ARTICLES[lang].includes(plain[0]!)) plain.shift();
  return plain.join("");
}

/** Edits from `a` to `b` (insert, delete, change), stopping early past `max`. */
export function distance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

export type Verdict = "yes" | "close" | "no";

/** Is `guess` the word? "close" when one letter is off (two in a long word) — said only to the guesser. */
export function judge(word: string, guess: string, lang: Lang): Verdict {
  const w = normalize(word, lang);
  const g = normalize(guess, lang);
  if (!g) return "no";
  if (g === w) return "yes";
  if (w.length >= 4 && distance(w, g, 2) <= (w.length >= 8 ? 2 : 1)) return "close";
  return "no";
}

// ---- hints ----

const isLetter = (ch: string) => /[\p{L}\p{N}]/u.test(ch);

/** The word as guessers see it before any hint: every letter a `_`, spaces and hyphens as they are. */
export function blankMask(word: string): string {
  return [...word].map((ch) => (isLetter(ch) ? "_" : ch)).join("");
}

/** How many letters a turn gives away: none for a short word, at most three, never half of it. */
export function hintCount(word: string): number {
  const letters = [...word].filter(isLetter).length;
  if (letters <= 3) return 0;
  if (letters <= 5) return 1;
  if (letters <= 8) return 2;
  return 3;
}

export interface Hint {
  /** Milliseconds into the turn. */
  at: number;
  /** The mask with this hint's letter (and every earlier one) shown. */
  mask: string;
}

/**
 * When each hint letter shows, and which: spread from 40 % to 85 % of the turn, at letter positions
 * picked with `random`, so the last stretch of a hard turn is a little easier.
 */
export function hintPlan(word: string, turnMs: number, random: () => number): Hint[] {
  const n = hintCount(word);
  const chars = [...word];
  let free = chars.map((ch, i) => (isLetter(ch) ? i : -1)).filter((i) => i >= 0);
  const mask = [...blankMask(word)];
  const plan: Hint[] = [];
  for (let k = 0; k < n; k++) {
    const pick = Math.min(free.length - 1, Math.floor(random() * free.length));
    const at = free[pick]!;
    free = [...free.slice(0, pick), ...free.slice(pick + 1)];
    mask[at] = chars[at]!;
    const share = n === 1 ? 0.55 : 0.4 + (0.45 * k) / (n - 1);
    plan.push({ at: Math.round(turnMs * share), mask: mask.join("") });
  }
  return plan;
}

/** A small seeded random (mulberry32), so a turn's hints can be tested and replayed. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
