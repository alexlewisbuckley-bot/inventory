# Bluecroft V2 — Screen Designs

**Date:** 29 July 2026
**Status:** Screen specification. No implementation.
**Inputs:** `product-audit-2026-07.md` · `ux-strategy-2026-07.md` · `design-system-v2.md`

Every screen below is a replacement, not an edit. Each specifies: **purpose ·
layout · anatomy · states · keyboard · responsive · what was removed.**

Wireframes are proportional, not pixel-accurate. Values in `code` are tokens
from the design system.

---

## 0. How the brief's fifteen areas map to V2

The strategy consolidated the object model. Nothing on the list is dropped;
several are the same screen seen from a different side, and saying so plainly
is the point of the redesign.

| Brief | V2 | Note |
|---|---|---|
| Dashboard | **Today** (§1) | Renamed because the name is the contract |
| Search | **Search & command** (§2) | Promoted to primary navigation |
| Inventory | **Stock** — list (§3), record (§4), intake (§5) | Three screens, one object |
| CRM | **Deals** — board (§6), record (§7) | The pipeline is a view, not a place |
| Customers | **Contacts** — list (§8), record (§9) | Customers + suppliers merged |
| Sales | **Sales ledger** (§10) + completion flow | The sale completes a deal |
| Purchases | **Sourcing** (§11) | Inbound deals — the missing half |
| Reports | **Insights** (§12) | Three questions, not a wall of charts |
| Notifications | **Notifications** (§13) | Demoted; Today carries the load |
| Activity timeline | **Timeline** (§14) | One component, four hosts |
| Settings | **Settings** (§15) | |
| User management | **People & access** (§16) | |
| Desktop / Tablet / Mobile | **§17** | One design, three densities |

**Every screen shares this chrome:**

```
┌────────────┬──────────────────────────────────────────────────────────┐
│            │  ⌘K Search        GBP ▾   🔔   ☾   AB ▾                  │ 60
│  bluecroft ├──────────────────────────────────────────────────────────┤
│            │                                                          │
│  ▸ Today   │   ← the screen                                           │
│  ▸ Stock   │                                                          │
│  ▸ Deals   │                                                          │
│  ▸ Contacts│                                                          │
│  ▸ Insights│                                                          │
│            │                                                          │
│  « Collapse│                                                          │
└────────────┴──────────────────────────────────────────────────────────┘
   224                            max 1440
```

---

## 1. Today

**Purpose.** *What should I do now?* — not *what do we own?*
Replaces a dashboard that showed stock figures to people whose job is selling.
(Audit C-2.)

### Layout

```
Good morning, Alex                                    Thu 29 July
────────────────────────────────────────────────────────────────────────
  ⚠  OVERDUE · 3                                            Clear all ⌄
  ○  Come back on the Dubai shipping price   Faisal Al Mansoori   1d   ⋯
  ○  Trade pricing for the three-piece lot   Marcus Reinhardt     3d   ⋯
  ○  Chase the bank transfer                 Tom Beckley          5d   ⋯

  ▸  DUE TODAY · 5
  ○  Follow up on the two options sent       Charlotte Whitmore   ⌄
  ○  …

  ◷  WAITING ON THEM · 2
  ○  Offer sent 4 days ago, no reply         Henry Osei · £14,800
────────────────────────────────────────────────────────────────────────
┌──────────────────────────┐  ┌──────────────────────────────────────┐
│ PIPELINE                 │  │ WORTH KNOWING                        │
│ £127,100 open            │  │ ● 126610LV arrived — Henry has been  │
│ £51,860 weighted         │  │   waiting 20 days          Call him →│
│ 2 closing this week   →  │  │ ● Faisal not contacted in 90 days  → │
│ ▁▃▅▆▃▁ by stage          │  │ ● 3 exchange rates over a month old →│
└──────────────────────────┘  └──────────────────────────────────────┘
┌──────────────────────────┐
│ STOCK                    │
│ 17 held · £170,372       │
│ 7 unpriced            →  │
└──────────────────────────┘
```

### Anatomy

**The agenda** is the screen. Three bands — overdue, due today, waiting on
them — each collapsible, each row acting in place: `x` completes, `s` snoozes,
`Enter` opens the related record, `⋯` reassigns or reschedules. A row names the
task, the person, and how late it is. Nothing here requires navigation.

**Waiting on them** is generated, not entered: offers sent with no reply after
three days, deals static for fourteen, invoices unpaid past terms. It is the
band that stops work disappearing into other people's inboxes.

**Pipeline, Stock** are two tiles, not eight. Each: one headline, one
supporting figure, one link. The sparkline is stage distribution, not time.

**Worth knowing** is the single automation surface (strategy §9). Matching,
quiet contacts, stale rates and ageing stock all report here rather than each
inventing a notification. Every line ends in the action that resolves it.

### States

**Empty** — "Nothing due. 4 deals are moving, 17 watches held." A genuinely
clear agenda is a good day, not a broken screen, and should read like one.
**Loading** — agenda rows skeleton at the correct height; tiles skeleton their
figures. Sub-120ms renders nothing.
**Error** — a band that fails shows inline "Couldn't load your tasks · Retry";
the rest of the screen still works. One failed query never blanks the page.

### Keyboard

`j`/`k` move · `x` complete · `s` snooze · `Enter` open · `⌘Z` undo the last
completion. Working eight follow-ups costs eight keystrokes.

### Role-aware

Owner leads with Pipeline and Stock, then the agenda. Sales leads with the
agenda. Operations leads with intake, in transit and despatch. Same screen,
ordered by what that person's day is made of.

### Removed from V1

Four metric tiles, four quick-action tiles, the attention queue, stock health,
the flow chart, capital by location, recent sales, oldest stock, recent
activity. **Ten regions to two tiles and a list.** All of it survives in
Insights or Stock, where it is looked at deliberately rather than daily.

---

## 2. Search & command

**Purpose.** Reach anything in two keystrokes. The primary navigation surface,
which is what allows the rail to be five items. (Audit C-3.)

### Layout

```
                    ┌────────────────────────────────────────┐
                    │ 🔍  reinhardt                          │
                    ├────────────────────────────────────────┤
                    │ CONTACTS                               │
                    │ ◐ Marcus Reinhardt   Reinhardt Zeit… ⏎ │
                    │ DEALS                                  │
                    │ ◈ Trade lot — three sports  Qualified  │
                    │ WATCHES                                │
                    │ ⌚ 1147 · Rolex 69173G  serial 1398     │
                    │ ────────────────────────────────────── │
                    │ ⏎ open   → peek   ⌘⏎ new tab           │
                    └────────────────────────────────────────┘
                              640, at 15vh
```

### Anatomy

One input, three jobs, disambiguated by what is typed — never by a mode.

| Typed | Returns |
|---|---|
| `reinhardt` | Records across every type, grouped |
| `+44 7700 900` | The contact, punctuation ignored |
| `1147` or `INV-2026-114` | Exact identifier match, ranked first |
| `>log call` | Actions |
| *empty* | Recents, then the five most-used actions |

**Every row shows its type icon and one disambiguating fact** — a watch shows
its serial, because two can share a reference; a contact shows their company;
a deal shows its stage.

**Ranking:** exact identifier → recently touched → open work → everything else.
Recency beats relevance in a product where people return to the same twenty
records for a fortnight.

**Peek** (`→`) opens the record as a non-navigating overlay: identity, last
activity, the two actions that matter. `Esc` returns you exactly where you
were. This is the answer to the phone ringing mid-task.

### States

**Loading** — the previous results stay, dimmed to 70%; no spinner, no jump.
**Empty** — "Nothing matches *reinhard*" plus "Create a contact called
reinhard" and "Search notes and activity instead". Never a blank panel.
**Error** — "Search is unavailable · Retry", with recents still listed.

### Keyboard

`⌘K` from anywhere including inside inputs · `↑↓` move · `Enter` open ·
`⌘Enter` new tab · `→` peek · `Esc` close. Results in under 100ms or the
palette has failed.

### Removed from V1

A watch-finder with five hard-coded navigation commands. The scope goes from
one object to six.

---

## 3. Stock — list

**Purpose.** *What do we hold, and what is it doing?*

### Layout

```
Stock                                     ⌄ Export    + Add watch
────────────────────────────────────────────────────────────────────────
[ All stock ] In stock  Unpriced 7  Ageing 17  Sold  + View
🔍 Search    Location: All ▾  Supplier: All ▾  + Filter          ⚙ Columns
────────────────────────────────────────────────────────────────────────
□  STOCK  WATCH              PURCHASED   COST     ASKING    MARGIN  STATUS
□  1364   Rolex 179383       11 Apr 26   £7,835   £12,345   +£4,510 ● In stock
          serial 40U90251                                            ⋯
□  1363   Rolex 179383       10 Apr 26   £7,597   £8,129    +£532   ● Reserved
          serial 91K22047
────────────────────────────────────────────────────────────────────────
Showing 1–25 of 17                                     25 ▾   ‹ 1 2 ›
```

### Anatomy

**View switcher** replaces the promoted navigation filters. "Unpriced" and
"Ageing" are views here, beside their siblings, where users can make more.
(Audit H-3.)

**Filter chips** use the one grammar (`field · operator · value`) and live in
the URL, so a filtered list is a link.

**Rows** are 44px comfortable / 36px compact. The identifying column carries
the reference *and the serial beneath it*, because two watches share a
reference and only the serial separates them. Money is right-aligned and
tabular; margin is coloured by sign.

**Inline edit** on asking price and location — click, type, blur. No drawer for
one field.

**Selection** enables the bulk bar: move, reprice, tag, export, delete. `⌘A`
selects everything matching the filter, not the page.

### States

**Empty (first run)** — "No stock yet" · "Add your first watch" · "Import a
spreadsheet".
**Empty (filtered)** — "No watch matches these filters" · "Clear filters".
The distinction matters: V1 told new users to widen filters they had never set.
**Loading** — 10 skeleton rows at the exact column widths.
**Error** — inline, with retry, header and filters still usable.

### Keyboard

`/` search · `j`/`k` move · `Enter` open · `→` peek · `x` select · `c` add ·
`e` edit the focused cell.

### Removed from V1

The four stat tiles above the table (moved to Insights; they are read weekly,
not hourly), the saved-view row rendered as buttons separate from the filter
bar, and the column picker as a modal — it becomes part of the view.

---

## 4. Stock — record

**Purpose.** *Everything about this watch, and who might want it.*

### Layout

```
Stock 1364 · Rolex 179383                    ● In stock    ⌄  Sell →
serial 40U90251 · Own inventory · held 108 days
────────────────────────────────────────────────────────────────────────
┌────────────────────────────────────┐  ┌──────────────────────────────┐
│ TIMELINE                           │  │ FACTS                        │
│ ┌────────────────────────────────┐ │  │ Reference   179383        ✎  │
│ │ Log a call, note or offer…     │ │  │ Serial      40U90251      ✎  │
│ └────────────────────────────────┘ │  │ Condition   Excellent     ✎  │
│                                    │  │ Box/papers  Watch only    ✎  │
│ ◈ Offer sent · £12,000             │  │ ─────────────────────────    │
│   to Faisal · 2 days ago           │  │ Cost        £7,835           │
│ ● Price changed £12,900 → £12,345  │  │ Asking      £12,345       ✎  │
│   Alex · 5 days ago                │  │ Margin      +£4,510 · 57%    │
│ ⌚ Booked in from GB Luxury         │  │ ─────────────────────────    │
│   11 Apr 2026                      │  │ Supplier    GB Luxury     →  │
│                            Show all│  │ Location    Own inventory ✎  │
└────────────────────────────────────┘  └──────────────────────────────┘
                                        ┌──────────────────────────────┐
                                        │ WHO MIGHT WANT THIS          │
                                        │ ✦ Marcus Reinhardt    Trade  │
                                        │   · Wants a Rolex            │
                                        │   · Collects Rolex        📞 │
                                        │ ○ Faisal Al Mansoori    VIP  │
                                        │   · Bought this reference    │
                                        │   · Spends in this band   📞 │
                                        │                    Show all 8│
                                        ├──────────────────────────────┤
                                        │ PHOTOGRAPHS         + Add    │
                                        │ [ ] [ ] [ ]                  │
                                        ├──────────────────────────────┤
                                        │ OWNED BY                     │
                                        │ Faisal Al Mansoori           │
                                        │ INV-2026-114 · 29 Jul  £9,500│
                                        └──────────────────────────────┘
```

### Anatomy

Standard record anatomy (system §6): identity, timeline left, facts right,
related below the facts.

**Facts are edited in place.** Every `✎` is a click-to-edit field; changes
write a system event to the timeline so the record explains itself.

**Who might want this** is the recommendation panel, ranked with reasons —
carried forward from V1 because it is right, and now sitting where it belongs
rather than beneath the history.

**Sell →** is the primary action. It opens the completion flow (§10.2), which
knows the watch and asks only what it cannot infer.

### States

**Empty** — a watch with no history shows "Booked in" and nothing else, which
is honest. Photographs empty shows a drop target. Who-might-want empty says
"Nobody on the book matches this yet" and links to Contacts.
**Loading** — identity and facts render immediately; timeline and
recommendations stream in behind skeletons. The expensive query never blocks
the cheap one.
**Error** — a panel that fails degrades alone.

### Keyboard

`e` edit the focused fact · `n` new note · `s` sell · `⌘Enter` save an edit ·
`Esc` revert.

### Removed from V1

The full history dumped into the page (twenty entries plus a link, as V1 was
eventually fixed to do — kept), and the separate edit page. **A record is
edited where it is read; the edit route disappears.**

---

## 5. Stock — intake

**Purpose.** Get a watch into the system in under a minute.

### Layout

```
                  ┌──────────────────────────────────────┐
                  │ Add a watch                       ✕  │
                  ├──────────────────────────────────────┤
                  │ Brand *        [ Rolex          ▾ ]  │
                  │ Reference *    [ 126610LV        ]   │
                  │ Supplier *     [ GB Luxury      ▾ ]  │
                  │ Cost *         [ £ 8,400         ]   │
                  │ Location *     [ Own inventory  ▾ ]  │
                  │                                      │
                  │ Serial, condition, papers and        │
                  │ photographs are added on the record. │
                  ├──────────────────────────────────────┤
                  │              Cancel   Add watch  ⌘⏎  │
                  └──────────────────────────────────────┘
```

### Anatomy

**Five fields.** Brand, reference, supplier, cost, location — what identifies
the watch and what it cost. Everything else is deferred to the record, where it
is edited in place.

**Every picker can create.** A brand, a supplier or a location that does not
exist is created from the field, never from another screen.

**On save:** the record opens, focused on the serial field, so the natural next
action continues without a navigation.

**The other route in** is a purchase deal completing (§11), which pre-fills all
five from what was already agreed and reduces this to a confirmation.

### States

**Loading** — the button shows a spinner and keeps its width.
**Error** — field-level on blur; form-level above the footer.

### Removed from V1

A fifteen-field page. **A form that asks fifteen questions before it will
accept anything teaches people to enter stock later, in a batch, from a
spreadsheet** — which is the behaviour this product exists to replace.

---

## 6. Deals — board

**Purpose.** *What is the shape of the month?*

### Layout

```
Deals                                              ⌄ Export   + New deal
────────────────────────────────────────────────────────────────────────
[ Selling ] Buying  Mine  Closing this month  All  + View     ⊞ Board ☰ List
🔍 Search    Owner: All ▾   + Filter
────────────────────────────────────────────────────────────────────────
 ENQUIRY 2      QUALIFIED 1     SOURCING 1      OFFER SENT 1    NEGOTIATION 1
 £16,700        £42,000         £16,500         £11,200         £34,500
┌────────────┐ ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌───────────┐
│Anniversary │ │Trade lot — │  │GMT-Master  │  │First Rolex │  │Daytona    │
│Datejust    │ │three sports│  │II enquiry  │  │— Datejust  │  │126500LN   │
│Priya Raman │ │M. Reinhardt│  │Sofia A.    │  │Charlotte W.│  │Faisal A.  │
│£7,800  10% │ │£42,000  25%│  │£16,500  35%│  │£11,200  50%│  │£34,500 65%│
│⌚1250 ⌛7 Sep│ │⌛19 Aug  AB│  │⌛23 Aug  SW │  │⌚1248 ⌛10Aug│ │⌚1364 ⚠1  │
└────────────┘ └────────────┘  └────────────┘  └────────────┘  └───────────┘
────────────────────────────────────────────────────────────────────────
✓ Won 1 · £14,800          ✗ Lost 1 · £5,400 — "bought elsewhere"
```

### Anatomy

**Open stages only.** Won and lost are outcomes, not places work sits; they
summarise beneath the board. Giving them columns turns a board into an archive.

**A card** carries: title, counterparty, value, probability, the watch if there
is one, expected close, owner initials, and an overdue-task warning. Nothing
else fits at 286px and nothing else is needed to decide whether to open it.

**Movement** is drag, or the stage control on the card, or `⌘→` from the
keyboard. Drag alone excludes keyboard users and phones. Moves are optimistic.

**Losing asks why**, in a modal, because the reason is the only thing a lost
deal is good for.

**Board ⇄ List** is one control over the same objects: board for shape, list
for bulk editing.

**Buying is the same board** (§11), filtered to inbound deals.

### States

**Empty** — "No deals yet" with "New deal", and a second line: "Deals also
appear when you log an enquiry against a contact."
**Loading** — column headers and their counts render immediately; cards
skeleton.
**Error** — the board keeps its columns and shows a retry in place of cards.

### Keyboard

`j`/`k` within a column · `h`/`l` between columns · `Enter` open · `⌘→`/`⌘←`
move stage · `c` new deal.

### Removed from V1

Four stat tiles above the board — 900px of chrome before a single deal on a
phone (audit H-6). They move to a single summary line and to Insights.

---

## 7. Deal — record

**Purpose.** *What is happening on this deal?* The object that had no record.
(Audit C-4.)

### Layout

```
Daytona 126500LN — white dial              Negotiation ▾   Won ✓   Lost ✗
Faisal Al Mansoori · VIP · £34,500 · 65% · closes 4 Aug · AB
────────────────────────────────────────────────────────────────────────
 Enquiry ──── Qualified ──── Sourcing ──── Offer ──●── Negotiation
   2d           1d             —             4d        3d so far
────────────────────────────────────────────────────────────────────────
┌────────────────────────────────────┐  ┌──────────────────────────────┐
│ TIMELINE                           │  │ THE WATCH                    │
│ ┌────────────────────────────────┐ │  │ ⌚ 1364 Rolex 179383      →  │
│ │ Log a call, note or offer…     │ │  │ Cost £7,835 · asking £12,345 │
│ └────────────────────────────────┘ │  │ Margin at £34,500: +£26,665  │
│ ☎ Price discussion · 15 min        │  ├──────────────────────────────┤
│   "Wants 34.5k inc. shipping to    │  │ OFFERS            + Offer    │
│   Dubai; said I would check."      │  │ £34,500 sent 2d ago · chase  │
│   Alex · 4 days ago                │  │ due tomorrow              ⋯  │
│ ◈ Moved to Negotiation             │  ├──────────────────────────────┤
│   Alex · 3 days ago                │  │ TASKS             + Task     │
│ ✉ Offer sent · £34,500             │  │ ○ Come back on shipping  1d ⚠│
│   Alex · 4 days ago                │  ├──────────────────────────────┤
└────────────────────────────────────┘  │ FACTS                        │
                                        │ Value    £34,500          ✎  │
                                        │ Close    4 Aug 2026       ✎  │
                                        │ Owner    Alex Buckley     ✎  │
                                        │ Source   Referral         ✎  │
                                        └──────────────────────────────┘
```

### Anatomy

**The stage rail** renders `deal_stage_events` — which V1 recorded and never
displayed — as elapsed time per stage. It is the answer to "why is this taking
so long" and the raw material for cycle-time reporting.

**Won / Lost are the two commitments**, placed apart from the stage dropdown
because they are terminal. Won opens the sale completion flow (§10.2); Lost
asks why.

**Related panels are where creation happens** — offer, task, and the watch link
— each pre-scoped so nothing is re-entered.

**Live margin.** The watch panel shows what this deal makes *at the current
deal value*, recomputed as the value changes. It is the number the negotiation
is actually about.

### States

**Empty** — a new deal shows the composer, the stage rail at step one, and
"Attach a watch" as a prompt.
**Loading** — identity and stage rail immediately; timeline and offers stream.
**Error** — per panel.

### Keyboard

`w` won · `L` lost · `⌘→` advance stage · `n` note · `o` offer · `t` task.

### New in V2

The whole screen. V1 had no deal record; cards linked to the customer.

---

## 8. Contacts — list

**Purpose.** *Who do we deal with?* — everyone, in one book.

### Layout

```
Contacts                                          ⌄ Export   + Contact
────────────────────────────────────────────────────────────────────────
[ Everyone ] Customers  Trade  Suppliers  Quiet VIPs  + View
🔍 Name, company, email or phone…   Owner: All ▾   + Filter    ⚙ Columns
────────────────────────────────────────────────────────────────────────
□  NAME                    ROLES        COUNTRY   OWNER   BOUGHT  LIFETIME
□  ◐ Faisal Al Mansoori    Buys   VIP   UAE       AB      1       £9,500
     Mansoori Holdings                                            ⋯
□  ◐ Marcus Reinhardt      Buys·Sells   Germany   AB      0       —
     Reinhardt Zeitmesser  Trade
□  ◐ GB Luxury Limited     Sells        UK        SW      —       £178,823
                                                          (supplied)
────────────────────────────────────────────────────────────────────────
Showing 1–25 of 43                                     25 ▾   ‹ 1 2 ›
```

### Anatomy

**One list for customers and suppliers**, distinguished by role chips — Buys,
Sells, or both. This is the change that makes "we have bought £180k from them
and sold them £40k" a single row rather than two records in two products.
(Strategy §4.1.)

**Views** carry the segments: Customers, Trade, Suppliers, Quiet VIPs, and
whatever the team invents.

**Columns adapt to the view.** A supplier view shows supplied-value and
response time where a customer view shows lifetime and last contact.

**Inline edit** on owner and tier. **Bulk actions:** assign owner, tag, change
segment, export.

### States

**Empty (first run)** — "No contacts yet" · "Add a contact" · "They also
appear when you record a sale."
**Empty (filtered)** — clear the filters.
**Loading** — 10 skeleton rows.

### Removed from V1

Two separate screens with different anatomies — a customer table and a supplier
table with an expander — and the segment tabs rendered separately from the
views.

---

## 9. Contact — record

**Purpose.** *Who is this, what have they bought, what did we last say?*

### Layout

```
Faisal Al Mansoori                                   ⌄ More    + Deal
Mansoori Holdings · Buys · VIP · UAE · 📞 +971 50 123 4567 · ✉ …
────────────────────────────────────────────────────────────────────────
 1 bought   £9,500 lifetime   £34,500 open   last spoken 3 days ago
────────────────────────────────────────────────────────────────────────
┌────────────────────────────────────┐  ┌──────────────────────────────┐
│ TIMELINE            All ▾          │  │ FACTS                        │
│ ┌────────────────────────────────┐ │  │ Prefers    WhatsApp       ✎  │
│ │ Log a call, note or offer…     │ │  │ Owner      Alex Buckley   ✎  │
│ └────────────────────────────────┘ │  │ Source     Referral       ✎  │
│ ☎ Price discussion · 15 min        │  │ Budget     £40k – £150k   ✎  │
│   Alex · 4 days ago                │  │ Birthday   14 Mar         ✎  │
│ 💬 Daytona availability            │  │ Marketing  Opted in 2 Feb    │
│   Alex · 2 days ago                │  ├──────────────────────────────┤
│ 💷 Bought stock 1147               │  │ DEALS             + Deal     │
│   29 Jul 2026 · £9,500             │  │ ◈ Daytona 126500LN  £34,500  │
└────────────────────────────────────┘  │   Negotiation · closes 4 Aug │
                                        ├──────────────────────────────┤
                                        │ WANTS             + Want     │
                                        │ Daytona 116500LN, panda      │
                                        │ up to £30,000 · Normal    ⋯  │
                                        ├──────────────────────────────┤
                                        │ WATCHES OWNED                │
                                        │ ⌚ 1147 Rolex 69173G  £9,500  │
                                        ├──────────────────────────────┤
                                        │ WHAT THEY BUY                │
                                        │ Rolex ×1 · typically £9,500  │
                                        │ In stock for them:           │
                                        │ ⌚ 1364 Rolex 179383  £12,345 │
                                        ├──────────────────────────────┤
                                        │ TASKS             + Task     │
                                        │ ○ Dubai shipping price   1d ⚠│
                                        └──────────────────────────────┘
```

### Anatomy

**Facts are role-aware.** A contact who buys shows budget, birthday and
marketing consent. One who sells shows payment terms, credit limit, VAT and
company number. One who does both shows both, in two groups — which is the
whole point of merging the objects.

**Timeline filter** (`All ▾`) narrows to conversations, transactions or system
events. V1's single unfilterable feed buried a real exchange under stage
changes. (Audit M-2.)

**Every related panel creates.** Deal, want, task, note — all pre-scoped to
this contact.

**What they buy** is derived from the ledger, not from what they once said, and
carries the stock that fits it.

### States

**Empty** — a new contact shows the composer and prompts on each panel:
"No deals yet — start one".
**Loading** — identity and facts immediately; timeline, taste and suggestions
stream.

### Keyboard

`n` note · `c` deal · `t` task · `w` want · `e` edit the focused fact.

### Removed from V1

Nothing meaningful — the customer record was the strongest screen in V1. It
gains the timeline filter, role-aware facts, and creation on every panel.

---

## 10. Sales

### 10.1 The ledger

**Purpose.** *What have we sold, and what is outstanding?*

```
Sales                                              ⌄ Export CSV
────────────────────────────────────────────────────────────────────────
[ All ] This month  Trade  Retail  Unpaid  Awaiting despatch  + View
🔍 Invoice, customer, reference…   From ▾  To ▾   + Filter
────────────────────────────────────────────────────────────────────────
DATE      INVOICE       WATCH            CUSTOMER        SALE    MARGIN
29 Jul    INV-2026-114  1147 Rolex …     Faisal A. VIP   £9,500  +£5,684
                                         Retail                  +59.8%
                                         ● Paid · Collected
28 Jul    INV-2026-113  1250 Rolex …     M. Reinhardt    £8,284  +£542
                                         Trade                   +6.5%
                                         ◐ Deposit · Awaiting despatch
────────────────────────────────────────────────────────────────────────
                        12 sales · £128,400 · +£31,900 (24.8%)
   Trade  4 · £52,000 · +£3,100 (6.0%)   Retail  8 · £76,400 · +£28,800 (37.7%)
```

**Anatomy.** The customer is a link and carries their segment, so a linked sale
and an unlinked one are visibly different (audit L-4). Payment and delivery are
two independent states on their own line, because "paid but not collected" and
"collected but not paid" are different problems.

**The footer splits trade and retail**, because a 6% trade margin and a 38%
retail margin averaged together describe neither.

**Invoice numbers are links** to the invoice document (§10.3).

### 10.2 Completing a sale

Reached from the deal (`w`) or from a stock row (`Sell`). The two routes
converge on one flow — V1 had two forms with different fields in a different
order, which is how one of them ended up unable to attribute a sale at all.

```
                  ┌──────────────────────────────────────┐
                  │ Complete this deal                ✕  │
                  │ 1364 Rolex 179383 · Faisal Al Mansoori│
                  ├──────────────────────────────────────┤
                  │ Sale amount *   [ £ 34,500      ] ▾  │
                  │ Invoice no *    [ INV-2026-115   ]   │
                  │ Date *          [ 29 Jul 2026    ]   │
                  │                                      │
                  │ Payment    ( Paid in full        ▾)  │
                  │ The watch  ( Collected           ▾)  │
                  ├──────────────────────────────────────┤
                  │ Bought £7,835 · Profit +£26,665 · 77%│
                  ├──────────────────────────────────────┤
                  │            Cancel   Complete sale ⌘⏎ │
                  └──────────────────────────────────────┘
```

**Three fields plus two states.** Customer, watch and value come from the deal.
Coming from stock with no deal, the customer picker appears — and can create.

**On completion:** the sale is recorded, the watch marked sold, the deal won,
the customer's history updated, and the invoice, delivery and check-in tasks
generated. One action, six consequences, all visible in the toast.

### 10.3 The invoice

A document, not a screen. Watch, serial, buyer, price, terms, warranty,
delivery. Printable and attachable to an email. Invoice numbers exist in V1 and
nothing was printable (audit L-3).

---

## 11. Purchases — sourcing

**Purpose.** *What are we trying to buy, and who is finding it?* The missing
half of the business. (Audit C-1, H-1.)

### Layout

```
Deals · Buying                                    ⌄ Export   + Purchase
────────────────────────────────────────────────────────────────────────
Selling  [ Buying ]  Mine  + View                          ⊞ Board ☰ List
────────────────────────────────────────────────────────────────────────
 DEMAND 3       SOURCING 2      QUOTED 1        COMMITTED 1     IN TRANSIT 1
┌────────────┐ ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌───────────┐
│GMT-Master  │ │Submariner  │  │Explorer II │  │Daytona     │  │Datejust 41│
│126710BLRO  │ │126610LV    │  │226570      │  │116500LN    │  │126334     │
│for Sofia A.│ │for Henry O.│  │3 asked ·   │  │GB Luxury   │  │GB Luxury  │
│up to £16.5k│ │2 asked     │  │2 quoted    │  │£24,000     │  │due 2 Aug  │
│⌛ 12 Sep    │ │⚠ 20 days   │  │best £8,900 │  │agreed 27Jul│  │           │
└────────────┘ └────────────┘  └────────────┘  └────────────┘  └───────────┘
```

### The purchase record

```
Submariner 126610LV for Henry Osei                Sourcing ▾   Commit →
Inbound · up to £15,000 · Henry Osei VIP · asked 20 days ago
────────────────────────────────────────────────────────────────────────
┌────────────────────────────────────┐  ┌──────────────────────────────┐
│ SUPPLIERS ASKED          + Ask     │  │ WHO WANTS IT                 │
│ GB Luxury      quoted £13,400  ✓   │  │ ◐ Henry Osei · VIP           │
│ 2 days · usually answers in 1d     │  │   up to £15,000 · urgent  →  │
│ Dad Dad Watches  no reply          │  ├──────────────────────────────┤
│ 5 days · usually answers in 3d  ⋯  │  │ ALREADY IN STOCK?            │
│ Chrono Supply  declined            │  │ ⌚ 1314 · unpriced · 126610LV │
│ "none until October"               │  │   Might already fit    →     │
├────────────────────────────────────┤  ├──────────────────────────────┤
│ TIMELINE                           │  │ FACTS                        │
│ …                                  │  │ Budget  £15,000           ✎  │
└────────────────────────────────────┘  │ Target  12 Sep            ✎  │
                                        └──────────────────────────────┘
```

### Anatomy

**A purchase is an inbound deal** (strategy §11), which is why it inherits the
board, the record, the timeline, tasks, permissions and reporting rather than
needing a second system.

**Suppliers asked** is the sourcing loop: ask, ranked by who supplies that
brand and how fast they answer; responses land against the deal and are
comparable side by side; accepting a quote moves the deal to Committed.

**"Already in stock?"** runs the matcher backwards — the most expensive mistake
in this business is going out to source a watch that is sitting in the safe.

**Commit → In transit → Booked in.** Booking in creates the watch record
pre-filled from the deal (§5), and notifies the customer who was waiting.

**Speculative buying** enters at Sourcing with no demand attached.

### States

**Empty** — "Nothing being sourced" · "Start a purchase" · "Purchases also
start from a customer's want."

### New in V2

The entire workflow. V1 had a supplier dropdown on a watch form.

---

## 12. Insights

**Purpose.** Three questions, not a wall of charts.

### Layout

```
Insights                          Last 12 months ▾    ⌄ Export
────────────────────────────────────────────────────────────────────────
WHAT IS OUR CAPITAL DOING?
┌──────────────────────┐ ┌──────────────────────────────────────────────┐
│ £170,372 deployed    │ │ Ageing  ▁▁▃▅▆  £129,979 over 90 days   →     │
│ 17 watches · avg 108d│ │ By brand · by location · by supplier         │
└──────────────────────┘ └──────────────────────────────────────────────┘

WHAT IS COMING?
┌──────────────────────────────────────────────────────────────────────┐
│ £51,860 weighted         Aug ▇▇▇▇  Sep ▇▇  Oct ▇                     │
│ Trade £12,400 · Retail £39,460                                       │
│ Last quarter we forecast £48,000 and closed £44,200 — 92% accurate   │
└──────────────────────────────────────────────────────────────────────┘

WHERE DO DEALS DIE?
┌──────────────────────────────────────────────────────────────────────┐
│ Enquiry ██████████ 24    → Qualified ███████ 17  (71%)               │
│ Qualified → Sourcing ████ 9 (53%)   ← biggest drop-off               │
│ Median dwell: Enquiry 2d · Qualified 5d · Sourcing 14d · Offer 4d    │
│ Win rate  Alex 62% · Sarah 41%      By source: Referral 71% …        │
└──────────────────────────────────────────────────────────────────────┘
```

### Anatomy

**Three sections, three questions.** Not a page of charts arranged by whatever
data was available.

**Every number links into the list that produced it.** A report you cannot
drill into is a report nobody trusts, and this one rule removes most export
requests.

**The forecast shows its own track record.** A forecast without one is a wish.

**Charts follow the system** (§1.6.4): one y-axis, validated palettes, legend
on every multi-series chart, hover layer, table view behind every figure.

**Trade and retail split everything**, because they are two businesses.

### States

**Empty** — "Not enough history yet. Revenue and margin chart here once you
have recorded a few sales." Never an empty axis.
**Loading** — skeletons at chart dimensions, not spinners.

### Removed from V1

A page of eight cards in no particular order, and every figure being terminal.

---

## 13. Notifications

**Purpose.** *What happened while I was away?* — deliberately demoted, because
Today carries anything requiring action.

```
Notifications                                    Mark all read
────────────────────────────────────────────────────────────────────────
[ All ] Unread  Mentions
● A watch arrived that Henry Osei is waiting for      2h    View →
  Stock 1314 · Rolex 126610LV
● Sarah recorded a sale · INV-2026-113 · £8,284       5h    View →
○ Marcus Reinhardt moved to Negotiation by Sarah      1d
```

**Anatomy.** Grouped by day. Unread carries a dot, not a background — a list of
tinted rows is unreadable. Every row links to the thing that happened. Read
state is per user.

**What belongs here:** things colleagues did, and things the system noticed
that do not need action. **What does not:** anything requiring action, which
belongs on Today as a task. That division is what stops the bell becoming a
second, competing inbox.

---

## 14. Activity timeline

One component, four hosts — contact, deal, watch, purchase. Specified once so
it cannot drift.

```
┌──────────────────────────────────────────────────────────┐
│ TIMELINE                                    All ▾        │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ ☎ Call ▾   Log what happened…                        │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
│ ☎  Price discussion                        Call  15 min  │
│ │  "Wants 34.5k inc shipping to Dubai."                  │
│ │  Alex Buckley · 4 days ago                             │
│ ◈  Moved to Negotiation                                  │
│ │  Alex Buckley · 3 days ago                             │
│ 💷 Bought stock 1147 · £9,500                            │
│    29 Jul 2026                                           │
└──────────────────────────────────────────────────────────┘
```

**Anatomy.** Composer at the top — logging what just happened is the most
frequent write in the product and must never be more than one click away.
Entries on a rail that stops at the last item. Conversations render in accent;
system events render in `content-secondary`, quieter, so a real exchange stands
out.

**Filter** (`All ▾`): Everything · Conversations · Transactions · System.

**Attachments** on any entry, reusing the image pipeline.

**Never paginated into oblivion:** twenty entries, then "Show all", then the
filtered audit trail. V1's watch record rendered every entry and reached nine
thousand pixels.

---

## 15. Settings

**Purpose.** Change how the system behaves, rarely.

```
Settings
────────────────────────────────────────────────────────────────────────
 Profile │ Application │ Currencies │ Notifications
────────────────────────────────────────────────────────────────────────
┌──────────────────┐  PREFERENCES
│      AB          │  Theme          ( Light | Dark | System )
│  Alex Buckley    │  Density        ( Comfortable | Compact )
│  Owner           │  Currency       [ GBP ▾ ]
│  alex@…          │  Default location [ Own inventory ▾ ]
└──────────────────┘  ─────────────────────────────────────────
                      PASSWORD
                      …
                      SIGNED-IN DEVICES              Sign out others
                      ● This device  Chrome on macOS · now
                        Chrome on iOS · 2 days ago
```

**Anatomy.** Tabs, not a nav group — settings are views of one thing. The
identity card is sticky beside the long right column. Devices are capped at ten
and the current one is marked; V1 rendered every session and produced a
ten-thousand-pixel page.

**Settings is in the account menu, not the rail** (strategy §4.2). Rail space
is for what people use hourly.

---

## 16. People & access

**Purpose.** Who can do what.

```
People & access                                        + Invite
────────────────────────────────────────────────────────────────────────
NAME              ROLE       SEES COSTS   LAST ACTIVE   STATUS
Alex Buckley      Owner      Yes          now           ● Active
 (you)
Sarah Whitfield   Manager    Yes          2 hours ago   ● Active   ⋯
Omar Haddad       Sales      No           yesterday     ● Active   ⋯
Priya Nair        Viewer     No           never         ○ Invited  ⋯
────────────────────────────────────────────────────────────────────────
WHAT EACH ROLE CAN DO
Owner      Everything, including permissions and permanent deletion
Manager    All records and financials. Cannot change permissions.
Sales      Full CRM and their pipeline. Cost prices hidden.
Operations Stock and purchasing. Customer financials hidden.
Viewer     Read-only, no financials.
```

**Anatomy.** Five roles including the two the audit found missing — **Sales**
(full CRM, costs hidden) and **Operations** (stock and purchasing, customer
financials hidden). "Sees costs" is a column, because it is the question
actually asked when granting access.

**Masked means masked everywhere** — tables, records, exports, search results.
Masking that leaks through one surface is not masking.

**A capability the role lacks removes the control**, rather than disabling it.
A disabled button is a question the user cannot answer.

---

## 17. Desktop, tablet, mobile

Not one design scaled. **One design, three densities, with a different job at
the small end.**

### Desktop ≥1024 — the working environment

Full rail, 8/4 record layout, dense tables, peek overlays, complete keyboard
model. Everything specified above assumes this.

### Tablet 640–1023 — the same product, less room

Rail collapses to 64px icons with tooltips. Record stacks to one column with
facts above the timeline — on a narrow screen the facts are the reference and
the timeline is the reading. Tables keep four to five columns and move the rest
behind the column picker. Board keeps horizontal scroll; touch targets go to
44px.

### Mobile <640 — the consultation environment

What people actually do on a phone: look somebody up, read what was last said,
log a call, mark a task done, check whether we still have the watch.

| Screen | Mobile |
|---|---|
| Today | The whole product's front door. Agenda, tap to complete, one tile. |
| Search | Full-screen, focused on open. The primary way to reach anything. |
| Stock | Cards: reference, serial, price, status. No table. |
| Deals | **Stage selector + one vertical list.** Never a board. |
| Contact | Tabs — Timeline first, Facts second. Call and WhatsApp are buttons. |
| Deal | Same, plus Won/Lost as a bottom bar. |
| Sales | Cards: invoice, customer, amount, margin. |
| Insights | The three headline figures only. Charts deferred. |
| Settings | Full, single column. |
| Intake, bulk edit, board drag | **Explicitly not supported.** |

**Bottom bar on mobile:** Today · Search · Deals · Contacts. Four, thumb-
reachable. The rail sheet holds the rest.

**The rule:** if a screen cannot be excellent on a phone, it should be honestly
absent rather than badly present. Booking in fifteen watches is a desk job.

---

## 18. Consistency matrix

The check that no screen invented its own behaviour.

| | Today | Stock | Deals | Contacts | Sales | Sourcing | Insights |
|---|---|---|---|---|---|---|---|
| Views + filter chips | — | ✓ | ✓ | ✓ | ✓ | ✓ | date only |
| Saveable as a view | — | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| URL carries state | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Bulk actions | ✓ tasks | ✓ | ✓ | ✓ | — | ✓ | — |
| Inline edit | ✓ | ✓ | ✓ | ✓ | — | ✓ | — |
| Peek from a row | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Empty / loading / error | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `c` creates in context | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Reachable from ⌘K | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Mobile treatment | full | cards | list | tabs | cards | list | figures |

---

## 19. What V2 deletes

Counted, because a redesign that only adds is not a redesign.

**Screens removed:** the watch edit page (edit in place) · the separate
supplier screen (merged into Contacts) · the standalone Wanted board (a view of
Deals · Buying) · the standalone Tasks page (Today, plus a view) · the
notifications page as a primary destination.

**Regions removed from the dashboard:** eight of ten.

**Navigation items:** thirteen to five.

**Forms shortened:** intake fifteen fields → five · sale completion twelve →
three plus two states.

**Two sale forms → one.**

**Confirmation dialogs:** all but the genuinely irreversible, replaced by undo.

**What none of it removes:** any capability. Everything V1 could do, V2 can do
in fewer interactions.

---

## 20. Build order

Screens in the order they unlock the most, matching the strategy's four
releases.

1. **Design system V2 primitives** — nothing else is buildable first
2. **Search & command, peek** (§2) — the navigation the rail depends on
3. **Today** (§1) — the front door
4. **Deal record** (§7) and **board** (§6) — the missing object
5. **Contacts** list and record (§8, §9) — including the merge
6. **Stock** list, record, intake (§3–5)
7. **Sales** ledger and completion (§10)
8. **Sourcing** (§11) — the new workflow
9. **Insights** (§12)
10. **Settings, People, Notifications** (§13, §15, §16)

Mobile treatments ship **with** each screen, never after. A screen that is
desktop-only in a release is a screen that stays desktop-only.
