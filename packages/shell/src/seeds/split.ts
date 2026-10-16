// Split's first-run records: a weekend in Lisbon — the hotel, the trams, a fado night, and a dinner
// split line by line from a photo of its receipt — and the flat at home with its bills.
//
// Nobody else has the app yet, but the trip was four of you: Lisbon names the other three as GUESTS
// (docs/04 §Guests) — Ana, Tom and Inês — so its balances are lively from the first run: Tom paid for
// the taxi, Ana for the fado, Inês for breakfast, and everyone owes everyone something. When one of
// them joins they say which guest they are, and every expense naming the guest names them.
//
// The Flat lists no guests, so nothing names who was in on its expenses, which the app reads as
// "everyone in the group, whoever that is when the maths runs": while you are alone the bills are
// simply yours and nobody owes anybody — the balances say "Just you so far" and ask you to invite the
// others — and the moment someone joins, the same records split with them.
//
// The expenses do name who paid — you, or a guest — when the device has an account. A demo link has
// none, and carries records but not an app's people, so its records name nobody, guests included: the
// app reads an expense nobody paid for as paid by whoever wrote it down, or, alone, by you.
//
// The Flat group keeps "Groceries" (€42.85) and "Internet" (€39.00): the sharing specs open on them.
import { newGuestId, writePeople, type Store } from "@potyro/store";
import type { SeedPhoto } from "../seed.js";

const DAY = 86_400_000;

export async function seedSplit(store: Store, me: string | undefined, photo: SeedPhoto): Promise<void> {
  if ((await store.all("group")).length > 0) return;
  const now = Date.now();
  const at = (daysAgo: number, hour = 12): Date => {
    const d = new Date(now - daysAgo * DAY);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const group = async (name: string, note: string, people: string[] = []): Promise<string> => String((await store.insert("group", { name, note, people })).id);
  // A guest is written the way `ctx.guests.add` writes one: into the app's people log, by you.
  const guest = async (name: string): Promise<string> => {
    const id = newGuestId();
    await writePeople(store, { kind: "add", guest: id, name }, me!);
    return id;
  };
  // Who paid, and who had what: a guest where there are guests, else nobody named.
  const by = (who: string | undefined): Record<string, unknown> => (who ? { paidBy: who } : {});
  const only = (...who: (string | undefined)[]): string[] => who.filter((w): w is string => Boolean(w));
  const expense = (g: string, description: string, amount: number, when: Date, over: Record<string, unknown> = {}) =>
    store.insert("expense", {
      description,
      amount,
      when,
      split: "equally",
      between: [],
      shares: [],
      exact: [],
      items: [],
      note: "",
      group: g,
      ...(me ? { paidBy: me } : {}),
      ...over,
    });

  // ---- a weekend in Lisbon, a week and a half ago ----
  const [ana, tom, ines] = me ? [await guest("Ana"), await guest("Tom"), await guest("Inês")] : [];
  const lisbon = await group("Lisbon weekend", "Friday to Sunday, four of us", only(ana, tom, ines));
  await expense(lisbon, "Flat in Alfama, 2 nights", 31200, at(12, 9), { category: "stay", note: "Booked in March; the one with the terrace" });
  await expense(lisbon, "Airport taxi", 2450, at(12, 11), { category: "transport", ...by(tom) });
  await expense(lisbon, "Pastéis de Belém", 1280, at(11, 10), { category: "food", ...by(ana) });
  await expense(lisbon, "Tram 28 day passes", 2560, at(11, 11), { category: "transport" });
  await expense(lisbon, "Pingo Doce: breakfast things", 3190, at(11, 18), { category: "groceries", ...by(ines) });
  const receipt = await photo("receipts/tasca-da-esquina.webp");
  await expense(lisbon, "Tasca da Esquina", 6400, at(11, 21), {
    category: "food",
    split: "items",
    // The lines on the receipt in the picture, to the cent: who had the mains, and the rest shared.
    items: [
      { name: "Bacalhau à Brás", price: 1450, people: only(tom) },
      { name: "Polvo à lagareiro", price: 1800, people: only(ana, ines) },
      { name: "2× Caldo verde", price: 700, people: [] },
      { name: "Vinho verde", price: 1600, people: [] },
      { name: "4× Pastel de nata", price: 600, people: [] },
      { name: "Água", price: 250, people: [] },
    ],
    ...(receipt ? { receipt } : {}),
  });
  await expense(lisbon, "Fado night tickets", 8000, at(10, 20), { category: "fun", ...by(ana) });
  await expense(lisbon, "Sintra train", 1800, at(10, 9), { category: "transport" });
  await expense(lisbon, "Sunset drinks, Miradouro", 2240, at(10, 19), { category: "food" });

  // ---- the flat at home ----
  const flat = await group("Flat", "Shared costs at home");
  await expense(flat, "Groceries", 4285, at(2), { category: "groceries" });
  await expense(flat, "Cleaning things", 1840, at(5), { category: "other" });
  await expense(flat, "Internet", 3900, at(9), { category: "bills" });
  await expense(flat, "Electricity", 6420, at(16), { category: "bills" });
}
