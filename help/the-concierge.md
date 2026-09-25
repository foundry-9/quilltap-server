---
url: /settings?tab=concierge
---

# The Concierge

> **[Open this page in Quilltap](/settings?tab=concierge)**

Every establishment of any standing keeps a Concierge: a discreet gentleman at the front desk who knows which tradesmen will take which commissions, and who — when the usual firm declines an errand on grounds of propriety — knows a less squeamish firm across the street. Quilltap's Concierge does precisely this for your conversations. When an ordinary provider refuses a turn, a background errand or a picture on content grounds, he carries the matter to the **uncensored desk**, says so in the chat, and, should the refusals pile up, moves the whole conversation there himself.

He now keeps an office of his own: a Settings tab labelled **The Concierge** (`/settings?tab=concierge`), with five cards.

| Card | What it governs | Deep link |
|---|---|---|
| **On Duty** | One switch: whether the Concierge works at all | `/settings?tab=concierge&section=on-duty` |
| **The Uncensored Desk** | Who is asked when the usual providers refuse — text, pictures, image descriptions, and the image-prompt crafter | `/settings?tab=concierge&section=uncensored-desk` |
| **When a Provider Refuses** | How many refusals before he switches a chat, and what posture new chats begin in | `/settings?tab=concierge&section=refusals` |
| **Display** | How flagged or Unmoderated content looks: show, blur or collapse, and warning badges | `/settings?tab=concierge&section=display` |
| **Pre-screening** (advanced) | The optional classifier that reads messages and chat summaries *before* anything is refused | `/settings?tab=concierge&section=pre-screening` |

## Where His Papers Used to Be

Formerly the Concierge's controls were scattered about the house like a butler's spare keys: a **Dangerous Content** card on the Chat tab, an uncensored fallback tucked into the Chat tab's **Image Description** card, and an "Image Prompt Expansion LLM" filed under the cheap-LLM settings. All three have moved into his office, and the Chat tab no longer carries any of them.

His old global mode — **Off**, **Detect Only**, **Auto-Route** — has been retired rather than renamed. Your settings were carried across as follows:

- **Off** → the Concierge is **off duty**.
- **Detect Only** and **Auto-Route** → the Concierge is **on duty**, with **pre-screening** and **summary classification** switched on, so the classifier keeps reading exactly as it did.

**One change of behaviour, stated plainly:** if you were on **Detect Only**, you will now get failover. Detect Only meant "flag, but never reroute"; being on duty now *means* rerouting a refused turn to the uncensored desk, and there is no longer a position that classifies but never reroutes. If what you want is warning badges without any uncensored model ever being asked, see [Badges Without the Uncensored Desk](#badges-without-the-uncensored-desk) below.

## What Is Never Moderated

The Concierge's jurisdiction is the roleplay surfaces — the Salon and autonomous rooms. **Help Chats and the Brahma Console are exempt entirely:** he never classifies, flags, reroutes, switches or announces on them, whatever his settings say. They are utility rooms, not drawing-rooms, and he has no standing there.

## The Three Postures of a Chat

Every chat stands in one of three positions with respect to the Concierge. You set it from the small brass control under the **Chat** section of the Chat Sidebar, or — before a conversation has uttered a word — on the new-chat form, directly above **Starting Scenario** (see [Chats Overview](chats.md)). A posture chosen on the form is in force from the very first word: the Concierge posts his note at the top of the fresh history, and the opening greeting is composed under the arrangement rather than discovering it after a refusal.

| Posture | Text, errands and pictures | When a provider refuses | May the Concierge move it? |
|---|---|---|---|
| **Moderated** (default) | the usual providers first | he takes it to the uncensored desk | yes, to Unmoderated |
| **Unmoderated** | the uncensored desk only, prompts written candidly | he tries the desk's own profile as a safety net | no |
| **Locked** | the usual providers only | the refusal stands | no |

### Moderated

The ordinary footing, and where every chat begins unless you have told him otherwise under **New chats start as**. The house's usual providers are asked first; should one decline on grounds of propriety, the Concierge quietly carries the matter to the uncensored desk and leaves a note. If the refusals pile up — or, with pre-screening on, the classifier reads the conversation and finds it spirited — he moves the whole chat to Unmoderated himself and announces it. Returning a chat here by hand clears his ledger of refusals and his classifier's verdict, so the matter is considered afresh.

### Unmoderated

The chat goes to the uncensored desk and nowhere else: text traffic, background errands (memory extraction, title revisions, summaries, scene tracking, story backgrounds) and pictures, with prompts drafted candidly. Nothing is classified, since there is nothing left to decide. Should the profile a chat is using refuse all the same — a character pointed at a profile that turns out to be more particular than advertised — the Concierge tries the desk's own profile as a safety net.

A chat arrives here in one of two ways, and the sidebar, the header pill and the list mark all say which:

- **You put it here.** *"You have opened the uncensored door yourself."* If the classifier keeps calling a spirited chat safe and you are tired of arguing with it, this is the position you want.
- **The Concierge put it here** — after too many refusals, or on reading the conversation. *"The Concierge moved this chat to the uncensored desk after two refusals. Set it back to Moderated if you disagree."* Choosing Unmoderated yourself on such a chat simply takes the decision as your own; nothing is announced and nothing about the routing changes.

The Concierge never moves a chat *out* of Unmoderated, so your hand will not be quietly overturned later.

### Locked

The usual providers only, ever. Nothing is classified, and if a provider refuses, the refusal stands: the Concierge will not carry the matter elsewhere and will never move the chat of his own accord. He does post a note when a refusal stands, so you know it happened and why. Image prompts go out with their customary concealment. This is the posture for the chat that must never reach an uncensored model — a shared or family conversation, say.

### Former names

In earlier editions the postures wore other names. **Moderated** was *Monitored* (and before that *Safe*); **Locked** was *Vouched Safe* (and before that *Off-duty*); and **Unmoderated** was two positions, *Flagged* for the Concierge's verdict and *Uncensored* for yours, which took the same road and differed only in who had sent them down it — now a note rather than a position. Every older chat was placed where it would keep behaving as before.

### Announcements and marks

Each change of posture is announced in the chat history by the Concierge himself, in his customary voice, so a later re-reading shows how the conversation came to be where it is. The Salon's header wears a small pill for any posture other than Moderated — red for Unmoderated, grey for Locked. Who set Unmoderated is in the pill's tooltip, never its colour. The same shades mark a chat wherever it is merely *listed* — the homepage's Recent Chats, the Salon's roll of conversations, a character's Conversations, a project's chats — where the pill contracts to a modest asterisk beside the message count. Moderated, being what everyone assumes, wears nothing at all.

## Card One: On Duty

A single switch. **On** (the default) and the Concierge does everything this page describes. **Off** and he does nothing whatsoever: no failover, no announcements, no auto-switch, no pre-screening. Every chat, whatever its posture, goes to its usual providers and a refusal is simply a refusal.

While he is off duty, the per-chat Concierge control in the Salon sidebar and on the new-chat form is shown but disabled, with a note pointing back here — *"The Concierge is off duty — turn him on in Settings → The Concierge."* A disabled control tells you where the switch is; a missing one would only leave you hunting.

## Card Two: The Uncensored Desk

The firm across the street — which profiles the Concierge turns to when an ordinary provider declines. The desk card is always visible, whatever else you have set.

- **Uncensored text profile** — the connection profile that takes a refused text turn or background errand, and that answers every turn in an Unmoderated chat.
- **Uncensored image profile** — the image profile that paints a refused picture, and every picture in an Unmoderated chat.
- **Uncensored vision profile** — the describer of last resort for attached pictures. When the primary image describer (Chat tab → **Image Description**) refuses to describe an attachment, or returns something so hedged it reads as a refusal, this profile is given its turn. Unlike the text and image pickers it never auto-detects — the vision understudy stands in only when you name one. (It lived on the Chat tab's Image Description card until now.)
- **Image-prompt crafter** — the language model that turns an image request into a finished prompt when the picture is bound for the uncensored desk: resolving character placeholders into visual descriptions and drafting the scene. Unlike the other three it may be **any** connection profile; left unset, your ordinary cheap LLM does the drafting. (This was the "Image Prompt Expansion LLM" on the Chat tab.)

The text and image pickers offer **auto-detect**, which takes the first profile you have ticked **Uncensored-compatible**. Naming a profile outright merely makes it the first choice; the tick alone is enough to make a profile a candidate for any reroute.

That **Uncensored-compatible** tick lives where it always has, on the profile forms themselves:

1. For text: **AI Providers** tab → **Connection Profiles** (`/settings?tab=providers&section=connection-profiles`), edit the profile, tick **Uncensored-compatible**, save.
2. For pictures: **Images** tab → **Image Profiles** (`/settings?tab=images&section=image-profiles`), likewise.

If no profile is ticked, the desk card says so and links you to both.

### Choosing an uncensored provider

**For a hosted service, we recommend xAI Grok** — the simplest route to mature or unrestricted content, for text and pictures alike. **For something you run yourself, use Ollama with an uncensored model, OpenRouter with an uncensored model selection, or any self-hosted model without content filtering.** See [Provider Recommendations](provider-recommendations.md).

A vision-capable text profile is the better choice where you can manage it. When a refused turn carries an attached picture and the understudy cannot read pictures, the Concierge swaps the picture for a written description rather than let the gateway reject the bundle outright — and auto-detect puts the profiles that *can* read the turn's attachments at the front of the queue — but a description is a summary, and the model that sees the original always has more to go on.

## Card Three: When a Provider Refuses

- **Switch a chat to Unmoderated after N refusals** — a number from 0 to 10, default **2**. When ordinary providers have plainly declined a Moderated chat this many times, the Concierge moves it to Unmoderated and says so. **0** means never.
- **New chats start as** — **Moderated** (the default) or **Unmoderated**. This is the posture preselected on the new-chat form, and the one a chat receives when it is created without a word on the subject. (Locked is always a deliberate choice, made on the chat itself.)

### The refusal rule

When an ordinary provider refuses on content grounds, the Concierge retries once on the uncensored desk: in a **Moderated** chat always, and in an **Unmoderated** chat as a safety net. In a **Locked** chat, never. He must be on duty for any of it.

A provider must *say* it refused for this to happen. A provider with a moderation layer of its own — Z.AI, OpenAI, Azure, Google — may return nothing at all and stamp the reply with a reason (`sensitive`, `content_filter`, `refusal`, `SAFETY` and so on), or may raise an error to the same effect ("rejected as a result of our safety system"). Quilltap reads either for what it is and repeats it to you plainly, naming the provider, the model and the word it used. For a text turn, the uncensored profile you named is asked first, then any profile ticked Uncensored-compatible, and only then the declining profile's own fallback chain — restricted, as ever, to stand-ins cleared for the content.

Formerly every empty reply earned the same suggestion — *please try resending your message* — which for a refusal is advice that cannot possibly work. The same content sent to the same moderation layer will be refused again, as many times as you care to ask. What does work is the uncensored desk, or changing what is being asked for; a refusal occasionally concerns a single phrase, or an attached picture, rather than the whole scene.

When a turn was carried across after a refusal, the placard beneath the avatar becomes a short list: the profile that declined, struck through and marked 🚫, above the one that obliged. Hover the marked line to learn whether the provider *stated* the refusal or merely returned nothing on a turn the Concierge had already flagged, in which case the refusal is inferred. See [Chats Overview](chats.md).

### When a picture is refused

Every picture Quilltap asks for — a character's `generate_image` call, the Lantern's backdrops, Aurora's portraits and the image dialog — follows the same rule, and whatever happens, the Concierge tells you in a small announcement of one of three kinds:

- **Rerouted.** The usual painter declined; he took the commission to the uncensored image profile, who obliged. The picture is attached as usual.
- **Nobody to ask.** The usual painter declined, and no uncensored image profile is available. Tick **Uncensored-compatible** on a suitable image profile, or name one on the desk, and the next refusal will be answered.
- **Not permitted.** The usual painter declined, and the chat is **Locked**. A Locked chat's text turns earn the same note when a provider plainly refuses them.

The Lantern keeps its own counsel on backdrops. When its painter declines the scene and nobody carries it across the street, the Lantern itself says so — *the usual painter would not take the scene, and the backdrop stays as it was* — and the Concierge holds his tongue, so one refusal earns one note. The Lantern's note appears whether or not the characters are told of new pictures, for it is addressed to you.

A text turn refused with nobody uncensored to ask earns the second note as well; a text turn that *is* rerouted needs none, because the placard already says so. The picture's own announcement, and the tool block for a `generate_image` call, carry the same struck-through list the text placard does. A picture quietly softened — a sanitized image, a "revised" prompt — counts as a success to the provider and the Concierge alike, and NanoGPT answers a filtered prompt with the same generic complaint it uses for a dozen other faults, so its refusals are not recognised at all.

### Try uncensored

A refusal ought never to be a dead end, and some refusals are too well-mannered to be caught at all — a polite paragraph declining the scene, a picture from which everything interesting has been tactfully removed. For these the Salon keeps a button that sends the very same request straight to the uncensored desk, once, without disturbing the chat's posture:

- **On a character's line** — the shield in the row of small icons beneath the message. The line is regenerated by the uncensored text profile and arrives as a new swipe beside the old one, narrated as it comes, exactly as the refresh icon's re-roll is. The trail beneath the avatar ends on the desk, marked as the Concierge's doing.
- **On a picture from `generate_image`** — **Try uncensored** on the tool block. The same request is painted afresh by the uncensored image profile, and the new picture is hung beside the old one. If the first painter had plainly refused, the Concierge leaves his usual note.
- **On the Lantern's refused backdrop** — **Try uncensored** on the Lantern's note. A fresh backdrop is commissioned from the uncensored image profile, and its prompt is written candidly, since it is bound for a studio that will take it.

The button never moves the chat to Unmoderated; that remains the sidebar's business, or the Concierge's after enough refusals. It is absent altogether on a **Locked** chat, where you have said *never*. It works whether or not the Concierge is on duty — he does not act on his own initiative when off duty, but he will carry a request you hand him personally. Should there be no uncensored profile to send it to, he says so: *There is no uncensored desk to send this to — appoint one under Settings → The Concierge.*

### When the Concierge switches a chat

The Concierge keeps a private ledger for every chat, and every refusal goes into it — a text turn, a background errand, a character's picture, a backdrop, a portrait — whether or not he managed to carry the work across the street. On a **Moderated** chat, once the ledger reaches your number, he stops sending the conversation to a desk that keeps declining it: he switches the chat to **Unmoderated** and leaves a note naming how many refusals it took and who refused last. The sidebar says so too.

- **Only a stated refusal counts.** An empty reply the Concierge merely *suspects* was a refusal does not go into the ledger: a guess is not evidence.
- **Only Moderated chats are switched.** An Unmoderated chat has nowhere further to go, and a Locked one is yours.
- **Returning a chat to Moderated clears the ledger,** so an old refusal cannot immediately undo your decision.
- **The ledger does not forget on its own.** One refusal last month and one today make two.

## Card Four: Display

How flagged content, and content in Unmoderated chats, is presented:

- **Show** — displayed normally, with a warning badge
- **Blur** — blurred behind a click-to-reveal overlay
- **Collapse** — hidden behind a collapsible placeholder
- **Warning badges** — whether category badges appear on flagged messages

A flagged message may carry **category badges** (coloured labels naming what was detected), a **Rerouted** badge (the message went to an uncensored provider), and a **Not Dangerous** button, which marks the message's flags as overridden by you and removes their visual effects: the blur lifts, or the collapsed message opens, at once. The badges themselves remain, struck through, as the record that the message was once flagged.

## Card Five: Pre-screening (Advanced)

Collapsed by default, and **off by default for new installs.** Everything above works on refusals, which are facts; pre-screening works on a classifier's guess, made *before* anything is sent. It costs a call per message and its verdicts are opinions, so it is here for those who would rather a flagged message never reached a moderated provider at all. It applies only to **Moderated** chats while the Concierge is on duty; Unmoderated and Locked chats are never classified.

- **Pre-screen** — the master switch for the classifier.
- **Threshold** — from 0.1 to 1.0. Lower flags more (0.1–0.4 is sensitive); **0.7** is the default; 0.8–1.0 flags only the plainly dangerous.
- **Custom classification prompt** — extra instructions appended to the classifier's prompt (for instance, "be more lenient with fantasy violence in roleplay").
- **Scan text messages** — classify your messages before they are sent. A flagged message in a Moderated chat goes straight to the uncensored desk rather than waiting to be refused.
- **Scan image prompts** — classify an image request before it is expanded.
- **Scan expanded image prompts** — classify the finished prompt before it goes to the painter.
- **Read each chat's summary in the background and switch it when it looks dangerous** — the summary classifier, described below.

### How the classifier decides

1. **OpenAI's moderation endpoint**, if you have an OpenAI connection profile. It is purpose-built, free with any OpenAI key, and returns structured category scores; its categories are mapped onto the Concierge's own (OpenAI's `sexual` becomes NSFW, `hate` becomes Hate Speech, and so on).
2. **Your cheap LLM**, otherwise, with a classification prompt. This costs tokens per message, its quality depends on the model, and each call is logged as a `DANGER_CLASSIFICATION` event.

Content is flagged when a category's score meets your threshold, or when the moderation provider flags it of its own accord. Results are cached by content hash for five minutes (up to 200 entries). Only your messages are scanned, never the characters' replies. Classification never blocks a message: if anything fails, the message goes through as usual.

The categories are **NSFW**, **Violence**, **Hate Speech**, **Self-Harm**, **Illegal Activity** and **Disturbing**.

### Reading each chat's summary

With the summary classifier on, the Concierge reads each Moderated chat as a whole — its compressed context summary, or before one exists its chosen scenario, or failing both its raw messages — and moves it to Unmoderated when the verdict is dangerous. He reads again after each new summary, re-checks chats he judged safe whenever new messages arrive, and sweeps any unread chats every ten minutes at low priority, so it never slows your active conversations. A chat he has moved is never read again: the verdict cannot flip-flop, and only your hand returns it to Moderated.

When he moves a chat this way, his announcement names *what drew his eye*: the contributing categories and their scores, the overall score, the threshold in force, and which assayer rendered the verdict. When the threshold was met it reads "registering X against the present threshold of Y"; when the assayer flagged the content by its own lights while the scores stayed below your bar, it says the matter was marked "by the direct verdict of" that assayer — so a notice can legitimately show a score beneath your threshold.

If you disagree, set the chat back to **Moderated** from the sidebar: that clears his verdict and his ledger, and the chat is read afresh. The API also offers `POST /api/v1/chats/[id]?action=reclassify-danger`, which clears the classifier's own record and re-queues it without moving the chat's posture.

## Story Background Prompts

The Lantern's story backgrounds hold a courtesy of their own. By default the prompt crafter translates any undressed or intimate moment into cinematic concealment — drapery, silhouette, foreground occlusion — because ordinary image providers reject the alternative. The concealment is dropped, and the scene described plainly, only when **all** of these hold:

- the Concierge is **on duty**;
- the chat is **Unmoderated**;
- you have **named** an uncensored image profile on the desk.

A refused backdrop in a Moderated chat is carried across the street like any other picture, but it is never *redrafted*: the concealed draft is what goes, merely painted by a less squeamish hand. A refusal buys a second painter, never a franker commission.

A picture that comes back unexpectedly demure has almost always lost one of two things:

- **The chat is Moderated, not Unmoderated.** A scene can be thoroughly undressed without the refusals or the classifier ever moving it. If a chat ought to be candid, set it **Unmoderated** yourself.
- **The adapter sits on a different profile from the one the desk names.** Configure a LoRA on one image profile while the desk points at another and a reroute will hand your scene to the other — obediently, and without the adapter. When you retire an uncensored profile, move the desk's setting across with it.

Read the prompt on the finished image to tell them apart: if it drapes the scene ("modestly concealed", "a sheet arranged just so"), the first condition failed; if it says plainly what the scene is and the picture is still demure, a provider or adapter declined it — see *The adapter seems to have made no difference* in [Image Generation Profiles](image-generation-profiles.md).

## What Changes in an Unmoderated Chat

- **No per-message classification, and no per-message badges.** The whole chat is already on the uncensored road, so the Concierge no longer pins a badge to every message saying so; the chat's own mark and the trail beneath each reply tell the story.
- **An uncensored provider you chose is left alone.** If a character already uses an uncensored-compatible profile, the Concierge does not swap it for the desk's; he steps in only if that profile refuses anyway.
- **Background errands go to the desk too.** Memory extraction, titles, summaries, scene tracking, story backgrounds and inter-character memory all use the uncensored text profile, so a squeamish cheap LLM cannot silently fail them.

## Badges Without the Uncensored Desk

If you want the Concierge's badges and blur but never want an uncensored model consulted, you have two honest arrangements:

- **Set the chats in question Locked.** Nothing is rerouted, nothing is classified, and a refusal stands with a note.
- **Give him nobody to ask:** leave every picker on the desk unset and untick **Uncensored-compatible** on every connection and image profile. He will still note each refusal, but there will be no one across the street.

## Quick-Hide Integration

The **Dangerous Chats** toggle in the quick-hide menu (the eye icon in the sidebar footer, under **Content Filters**) hides every chat on the uncensored road — every **Unmoderated** chat, whoever put it there — from the sidebar, the projects section and the all-chats page. Locked and Moderated chats stay where they are. The preference is kept in your browser's local storage. See [Quick-Hide](quick-hide.md).

## In-Chat Settings Access

Characters with help tools enabled can read the Concierge's settings during a conversation using the `help_settings` tool with `category: "concierge"`. Ask a help-tools-enabled character something like "What are my Concierge settings?" and it will look them up.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=concierge")`

Or straight to a particular card:

- `help_navigate(url: "/settings?tab=concierge&section=on-duty")`
- `help_navigate(url: "/settings?tab=concierge&section=uncensored-desk")`
- `help_navigate(url: "/settings?tab=concierge&section=refusals")`
- `help_navigate(url: "/settings?tab=concierge&section=display")`
- `help_navigate(url: "/settings?tab=concierge&section=pre-screening")`

## Related Topics

- [Settings](settings.md) - The whole of the Settings page
- [Connection Profiles](connection-profiles.md) - Set up LLM providers and the Uncensored-compatible tick
- [Image Generation Profiles](image-generation-profiles.md) - Configure image providers
- [Provider Recommendations](provider-recommendations.md) - Which providers suit the uncensored desk
- [Story Backgrounds](story-backgrounds.md) - The Lantern's backdrops
- [Quick-Hide](quick-hide.md) - Hiding Unmoderated chats
- [Chats Overview](chats.md) - The new-chat form and the reply placard
