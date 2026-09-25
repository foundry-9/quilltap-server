---
url: /settings?tab=chat&section=dangerous-content
---

# Dangerous Content Handling

Dangerous Content Handling is a feature that classifies messages for sensitive or potentially policy-violating content and optionally routes them to uncensored-compatible LLM providers.

## Overview

When enabled, the system classifies user messages before they are sent to the main LLM. Content that exceeds the configured threshold is flagged and can be:

- **Detected and flagged** with warning badges (Detect Only mode)
- **Automatically routed** to an uncensored-compatible provider (Auto-Route mode)

The system is designed to be fail-safe: classification errors never block your messages.

### What is never moderated

Moderation applies only to roleplay surfaces — the Salon and autonomous rooms. **Help Chats and the Brahma Console are exempt entirely:** the Concierge never classifies, flags, reroutes, or announces on them, regardless of your global settings. They are utility surfaces, not roleplay, so the gatekeeper has no standing there.

### Smart Classification

Quilltap automatically selects the best available classification method:

1. **OpenAI Moderation Endpoint** (preferred): If you have an OpenAI connection profile configured, Quilltap uses OpenAI's dedicated moderation endpoint automatically. This endpoint is purpose-built for content classification, is free to use with any OpenAI API key, and returns structured category scores. No additional configuration is needed — simply having an OpenAI connection profile is sufficient.

2. **Cheap LLM Fallback**: If no OpenAI connection profile is available (or no moderation provider plugin is installed), Quilltap falls back to sending the content to your configured Cheap LLM with a classification prompt. This costs tokens per message and depends on the Cheap LLM's quality.

The system tries the moderation provider first and transparently falls back to the Cheap LLM if needed.

## Modes

### Off (Default)

No content scanning or routing. Messages are sent directly to your configured LLM provider.

### Detect Only

Messages are scanned and flagged with danger categories (e.g., NSFW, Violence, Hate Speech) but are still sent to your regular provider. Flagged messages display warning badges and can be blurred or collapsed based on your display settings.

### Auto-Route

Messages are scanned, and flagged content is automatically rerouted to an uncensored-compatible provider. If no uncensored provider is available, the message is sent to your regular provider with a warning notification.

## Configuration

Navigate to the **Chat** tab in Settings (`/settings?tab=chat&section=dangerous-content`) and expand **Dangerous Content Handling** to configure:

### Detection Threshold

A slider from 0.1 to 1.0 that controls sensitivity:
- **Lower values** (0.1-0.4): More sensitive, flags more content
- **Default** (0.7): Balanced sensitivity
- **Higher values** (0.8-1.0): Only flags strongly dangerous content

### Scan Toggles

- **Text Chat Messages**: Classify user messages before sending to the LLM
- **Image Prompts**: Classify image generation prompts before expansion
- **Image Generation**: Classify the expanded prompt before sending to the image generator

### Uncensored Providers (Auto-Route only)

- **Text LLM Profile**: Select a specific connection profile or auto-detect
- **Image Generation Profile**: Select a specific image profile or auto-detect

When set to auto-detect, the system scans all your profiles marked as "Uncensored-Compatible" and uses the first available one.

### Switch a Chat to Unmoderated After This Many Refusals

A number from 0 to 10 (default **2**). When a provider has plainly declined a Moderated chat this many times on grounds of propriety, the Concierge moves the whole conversation to the uncensored desk and says so. Set it to **0** and he never does. It acts only under Auto-Route; see [When the Concierge Switches a Chat](#when-the-concierge-switches-a-chat) below.

### Display Settings

- **Show**: Display flagged content normally with a warning badge
- **Blur**: Blur flagged content with a click-to-reveal overlay
- **Collapse**: Hide flagged content behind a collapsible placeholder
- **Warning Badges**: Toggle category badges on flagged messages

### Custom Classification Prompt

Additional instructions appended to the content classifier's system prompt. Use this to adjust sensitivity for your specific use case (e.g., "Be more lenient with fantasy violence in roleplay contexts").

## Setting Up Uncensored Providers

To use Auto-Route mode, you need at least one connection profile marked as uncensored-compatible:

1. Go to the **AI Providers** tab in Settings (`/settings?tab=providers&section=connection-profiles`) and expand **Connection Profiles**
2. Edit or create a profile that connects to an uncensored-compatible model
3. Check the **"Uncensored-compatible"** checkbox
4. Save the profile

The same applies to image profiles if you want image generation routing. **The tick alone is enough**: an image profile marked "Uncensored-compatible" is a candidate for every reroute, whether or not you have named it in the Concierge's picker. (Formerly a picture refused *after* it was requested could only be carried to a profile named outright in the picker, and a merely ticked profile stood idle while the refusal went unanswered.)

Common uncensored-compatible setups:
- Local Ollama models (many models have uncensored variants)
- OpenRouter with uncensored model selections
- Self-hosted models with no content filtering

## How Classification Works

### With Moderation Provider (OpenAI)

1. Your message is sent to the OpenAI moderation endpoint (`/v1/moderations`)
2. The endpoint returns structured category flags and confidence scores (e.g., `sexual: 0.92`, `violence: 0.01`)
3. Provider-specific categories are mapped to Concierge categories (e.g., OpenAI's `sexual` → `nsfw`, `hate` → `hate_speech`)
4. If any category score exceeds your threshold, or the provider flags the content, it is marked as dangerous
5. Classification results are cached by content hash (5 minute TTL, up to 200 entries)

### With Cheap LLM (Fallback)

1. Your message is sent to the Cheap LLM with a classification prompt
2. The LLM returns a JSON response with danger categories and scores
3. If the overall score exceeds your threshold, the content is flagged
4. Classification results are cached by content hash (5 minute TTL, up to 200 entries)
5. Each classification is logged as a `DANGER_CLASSIFICATION` system event for cost tracking

### Categories

The classifier checks for:
- **NSFW**: Sexual or explicitly adult content
- **Violence**: Graphic violence, gore, or descriptions of harm
- **Hate Speech**: Hateful, discriminatory, or dehumanizing language
- **Self-Harm**: Content encouraging or depicting self-harm
- **Illegal Activity**: Content describing or encouraging illegal activities
- **Disturbing**: Deeply disturbing, shocking, or upsetting content

## Message Flags

Flagged messages display:
- **Category badges**: Colored labels showing which categories were detected
- **Rerouted badge**: Blue badge indicating the message was sent to an uncensored provider
- **"Not Dangerous" button**: Allows you to override the classification

Overriding a message's danger flags marks all flags as user-overridden and removes the visual effects.

## Image Prompt Expansion

When an image prompt is flagged as dangerous, the system can use a separate uncensored LLM for prompt expansion (the step where character placeholders are resolved into visual descriptions). Configure this in the **Chat** tab in Settings (`/settings?tab=chat&section=dangerous-content`) under **Cheap LLM Settings** > "Image Prompt Expansion LLM (Uncensored - Optional)." If not set, the standard cheap LLM is always used for prompt expansion.

## Story Background Prompts

The Lantern's story backgrounds hold a second, separate courtesy. By default the prompt crafter translates any undressed or intimate moment into cinematic concealment — drapery, silhouette, foreground occlusion — because ordinary image providers reject the alternative.

That courtesy is now conditional. When a chat is **Unmoderated** **and** you have an uncensored image profile configured, the picture is already headed for a door that does not moderate, so the crafter describes the scene plainly instead. Previously the concealment applied regardless, and an uncensored provider received a scene needlessly draped for a provider it was never going to see.

A refused backdrop is rerouted too, for any Moderated or Unmoderated chat under **Auto-Route**. (A **Locked** chat's refusal stands; see below.) If a standard provider declines the picture on grounds of propriety, the Concierge carries the very same prompt across the street to an uncensored image profile — the one named in his settings, or failing that any profile ticked "Uncensored-compatible" — and says so in the chat.

What he never does is *redraft* it. A Moderated chat's backdrop was drafted with its customary concealment, and it is the concealed draft that goes across the street; an Unmoderated chat's was drafted candidly to begin with, and goes as it stands. A provider's refusal therefore buys a second painter, never a franker commission. (For a season the Concierge took a refusal as licence to redraft a moderated chat's scene plainly for the uncensored profile, which promoted a chat you had deliberately left moderated on the say-so of a safety filter; he has been spoken to, and the redrafting is gone for good. For a further season he would not carry a Moderated chat's backdrop across the street at all, which left the picture unmade for want of a second opinion. That, too, is mended.)

Under **Detect Only** or **Off**, nothing is rerouted, and the candid draft is not attempted either — a franker prompt is written only for a picture that can actually reach the uncensored door. The Concierge posts a note when a backdrop is refused under those modes, so you know what Auto-Route would have done.

Concealment applies as before to every chat that is not headed for the uncensored profile, and the character appearance descriptions are sanitized alongside it. Note the distinction: what matters is whether *this* picture is going through the uncensored door, not whether such a door exists somewhere in your settings. A configured uncensored profile does nothing for a Moderated chat's backdrop, and used to be mistaken for a licence to leave its appearance descriptions unsanitized.

### Both conditions, and how they are commonly missed

The candid draft requires **two** things at once, and a picture that comes back unexpectedly demure has almost always lost one of them.

**The chat must actually be Unmoderated, not merely eligible.** Under Auto-Route the Concierge moves a chat to Unmoderated when the classifier's score clears your **Detection Threshold** (or after enough refusals), and a chat can be thoroughly undressed while scoring well under it — the classifier weighs the whole compressed summary, not the state of anybody's wardrobe. A scene may therefore sit at a score of 0.3 against a threshold of 0.8, stay Moderated, and receive the concealed draft for as long as it likes. If a chat ought to be candid and the classifier disagrees, take the decision out of its hands with the per-chat Concierge switch described below — set the chat **Unmoderated** yourself. The Concierge never moves a chat out of Unmoderated, so your hand will not be quietly overturned later.

**The adapter must sit on the profile the Concierge actually routes to.** The **Image Generation Profile** named under *Uncensored Providers* is a distinct setting from whichever profile a given chat happens to use. Configure a LoRA on one profile while the Concierge points at another and a reroute will hand your scene to the other profile — correctly, obediently, and without the adapter. When you retire an uncensored profile in favour of a new one, move this setting across with it.

A useful way to tell the two failures apart after the fact: read the prompt on the finished image. If it drapes the scene ("modestly concealed", "silhouetted", "a sheet arranged just so") the crafter was working from the concealed instructions and the first condition failed. If it says plainly what the scene is and the picture is still demure, the prompt reached a provider or an adapter that declined it — see *The adapter seems to have made no difference* in [Image Generation Profiles](image-generation-profiles.md).

## Chat-Level Classification

In addition to per-message scanning, Quilltap can classify entire chats as dangerous based on the compressed context summary. This happens automatically in the background once there is something to read.

### How It Works

1. After a new context summary is generated for a chat, a background job is queued
2. The context summary is sent to the Cheap LLM gatekeeper for classification
3. The chat is marked as dangerous or safe based on the threshold; a dangerous verdict on a Moderated chat moves it to **Unmoderated**, with the Concierge's name on the change

**Before a chat has a summary, the Concierge reads its scenario instead.** A summary takes several exchanges to appear, and the Concierge would rather not spend those exchanges blind — so a chat opened on a scenario is assayed on that scenario from its first turn, and re-assayed against the real summary once one exists. The scenario is a fair early witness to where a conversation is headed, and it is the only thing on the table at that point; a chat with neither a summary nor a scenario is classified from its raw messages instead.

### Sticky Classification

The classifier only ever reads **Moderated** chats. Once it has moved a chat to Unmoderated it never reads that chat again, so the verdict cannot flip-flop as the conversation evolves; only your hand returns it to Moderated. Chats it judged safe are re-checked whenever new messages are added (message count changes). Locked chats are never read at all.

### In-Chat Announcement

When a chat is first marked as dangerous, the Concierge — one of "the Staff" — steps quietly to the table and posts a brief message of his own. Worded with deliberate discretion, it lets every character at the table (those who can see the Staff) know that the conversation, and any errands attending it, will henceforth be entrusted to a desk better suited to the matter. The announcement carries the Concierge's avatar and is part of the normal chat history; nothing further is required of the user.

The announcement now names *what drew his eye* — the contributing categories with their severity scores, the overall score, the threshold in force, and which assayer (moderation provider or cheap-LLM fallback, by provider name) rendered the verdict. This makes it transparent why the reroute happened and lets you tune the threshold or correct misclassifications with confidence.

The wording also distinguishes *how* the verdict was reached. A chat is marked dangerous when **either** the overall severity meets your threshold **or** the assayer flags the content of its own accord — moderation providers such as OpenAI return a `flagged` decision against their own internal catalogue, independent of your numeric threshold, so this fires even when the reported severities sit well below it. When the threshold was actually met, the announcement reads "registering X against the present threshold of Y." When the assayer flagged it directly while the severities stayed below the bar, it instead says the matter was marked "by the direct verdict of" the assayer, reports the (sub-threshold) severities for context, and notes that it was the assayer's judgement — not the arithmetic — that drew his eye. So a notice can legitimately show a severity *below* your configured threshold.

### Optimizations for Unmoderated Chats

When a chat is **Unmoderated** — by the classifier's verdict, the refusal ledger, or your own hand — Quilltap applies several optimizations to save tokens and avoid futile content refusals:

- **Per-message classification is skipped**: Since an Unmoderated chat goes to the uncensored desk regardless, individual message scanning is bypassed entirely. Danger flags are synthesized from the stored chat-level categories instead.
- **Uncensored providers are not rerouted unnecessarily**: If you have already assigned an uncensored-compatible provider to a character (e.g., DeepSeek), the Concierge will not swap it for the configured uncensored fallback. It only falls back to the configured provider if the current one returns an empty response (suggesting it was caught by censorship anyway).
- **All background tasks use uncensored providers**: Memory extraction, title generation, context summaries, scene state tracking, story backgrounds, and inter-character memory tasks all automatically use your configured uncensored provider in Unmoderated chats. This prevents content refusals from censored providers that would otherwise silently fail these background operations.

### Manual Reclassification

If the Concierge moved a chat to Unmoderated and you disagree, set it back to **Moderated** from the sidebar: that clears his verdict and his ledger, and the classifier reads the chat afresh on the next message. The API also offers `POST /api/v1/chats/[id]?action=reclassify-danger`, which clears the classifier's own record and re-queues it; it never moves a chat's position, so it does nothing for an Unmoderated or Locked chat until you set it back to Moderated.

## When a Provider Refuses Outright

There is a distinction worth drawing between a model that *declines* and a model that *falters*, because the remedies are entirely different and one of them used to be offered for both.

A provider with a moderation layer of its own — Z.AI, OpenAI, Azure, Google — may simply refuse a turn. When it does, it says so: it returns nothing at all and stamps the reply with a reason of its own choosing (`sensitive`, `content_filter`, `refusal`, `SAFETY`, and so on). This is testimony, not a hiccup, and Quilltap now reads it and repeats it to you plainly, naming the provider, the model, and the word it used.

Formerly every empty reply was met with the same suggestion — *this is a known issue with some providers, please try resending your message* — which for a refusal is advice that cannot possibly work. The same content sent to the same moderation layer will be refused again, and again, as many times as you care to ask.

What does work:

- **Reroute the chat to an uncensored provider.** This is precisely what the Concierge's Auto-Route mode exists for; see *Modes* above.
- **Change what is being asked for.** Occasionally the refusal is about a single phrase or a single image rather than the whole scene.

The same holds when a provider refuses by *raising an error* rather than by returning nothing — the shape OpenAI, for one, prefers ("rejected as a result of our safety system"). Such a refusal was once mistaken for a malformed request of Quilltap's own and simply reported; it is now read for what it is, and under Auto-Route the Concierge sends the turn to the uncensored desk before trying any other understudy. The profile you named as uncensored is asked first, then any profile ticked "Uncensored-compatible", and only then the declining profile's own fallback chain — restricted, as ever, to stand-ins cleared for the content.

Note that a refusal may concern an *image* you have attached quite as readily as anything written. If a vision model has been declining a picture, its reason will now say so rather than leaving you to guess at a blank reply.

A refusal also leaves its mark on the reply that eventually arrived. Where the Concierge sent the
turn on to an uncensored profile after a refusal, the placard beneath the avatar becomes a short
list: the profile that declined, struck through and marked 🚫, above the one that obliged. Hover
the marked line and it will tell you whether the provider *stated* the refusal — naming its own
`finish_reason` — or whether it merely returned nothing on a turn the Concierge had already
flagged, in which case the refusal is inferred rather than testified to. See
[Chats Overview](chats.md) for the whole of that little placard.

### When a Picture Is Refused

Every picture Quilltap asks for — a character's `generate_image` call, the Lantern's backdrops, Aurora's portraits, and the image dialog — now follows the same rule: if the provider declines on content grounds, the Concierge tries the uncensored image desk once (under Auto-Route), and whatever happens, he tells you. His note arrives as a small announcement in the chat, of one of three kinds:

- **Rerouted.** The usual painter declined; he took the commission to your uncensored profile, who obliged. The picture is attached as usual.
- **Nobody to ask.** The usual painter declined, and no uncensored image profile is available. Tick "Uncensored-compatible" on a suitable image profile, or name one in the Concierge's settings, and the next refusal will be answered.
- **Not permitted.** The usual painter declined, and the Concierge may not go elsewhere: either his mode (Detect Only or Off) forbids it, or the chat is **Locked**. The note says which. A Locked chat's text turns earn the same note when a provider plainly refuses them.

A text turn that is refused with nobody uncensored to ask earns the second note as well; a text turn that *is* rerouted needs none, because the placard under the avatar already says so.

The picture's own announcement, and the tool block for a character's `generate_image` call, carry the same short list the text placard does: the profile that declined, struck through and marked 🚫, above the one that drew it. Image profiles are listed by the name you gave them. The tool's report to the character names the model that actually drew the picture, not the one first asked.

A provider must *say* it refused for any of this to happen. A picture quietly softened — a sanitized image, a "revised" prompt — counts as a success to the provider and to the Concierge alike. NanoGPT answers a filtered prompt with the same generic complaint it uses for a dozen other faults, so its refusals are not recognised at all.

### When the Concierge Switches a Chat

The Concierge keeps a private ledger for every chat, and each refusal goes into it — a text turn, a background errand, a character's picture, a backdrop, a portrait — whether or not he managed to carry the work across the street afterward. On a **Moderated** chat under **Auto-Route**, once the ledger reaches the number set under *Switch a chat to Unmoderated after this many refusals* (two, unless you have said otherwise), he stops sending the conversation to a desk that keeps declining it: he switches the chat to **Unmoderated** and leaves a note to that effect, naming how many refusals it took and who refused last. The switch is his, and the sidebar says so: *"The Concierge moved this chat to the uncensored desk after two refusals."* From then on the chat's text, its errands and its pictures go to the uncensored desk first.

A few particulars, since the ledger is a stickler:

- **Only a stated refusal counts.** The provider must have said it was declining on grounds of content — an error to that effect, a moderation stop reason, the familiar wording. An empty reply on a chat the classifier had already marked, which the Concierge reads as a probable refusal, does not go into the ledger: a guess is not evidence.
- **Only Moderated chats are switched.** An Unmoderated chat has nowhere further to go, and a Locked one is yours: the Concierge does not overrule you. Refusals on those chats are still noted in his ledger, but nothing is done with them.
- **Returning a chat to Moderated clears the ledger.** If you move a chat back to Moderated by hand, the Concierge starts his tally afresh, so an old refusal cannot immediately undo your decision.
- **The ledger does not forget on its own.** One refusal last month and one today make two.

### When the Turn Is Carrying a Picture

A reroute swaps the model but keeps the conversation already assembled — and if the profile you began the turn with reads pictures, that assembly has a picture *in* it, in the raw. Hand that bundle to a substitute that reads only words and the gateway will not even trouble the model with it: it returns a flat refusal of its own, the character says nothing at all, and the whole rescue is spent before it starts. This was, for a time, precisely what happened, and with a faultlessly configured pair of profiles on either side of the swap.

The Concierge now asks the substitute what it can read before handing anything over.

- **Choosing the understudy.** When no uncensored profile has been named and the Concierge is scanning your profiles for one, it now puts the profiles that can take the turn's attachments at the front of the queue. It does not strike the others out — a described picture is worth a great deal more than a silent character — but it will not reach past a capable model for an incapable one.
- **Preparing the payload.** Whichever profile is called, uncensored or not, named by you or found by the scan, the attachment question is asked again on its behalf. A picture the substitute cannot see is replaced by a written description of it — the same courtesy Quilltap extends to any text-only model you attach a photograph to — and the retry proceeds with the words instead of the bytes. A substitute that *can* see receives the picture untouched, exactly as before.

The practical upshot is that an image-bearing turn is no longer the one turn the Concierge's last line of defence cannot cover. You may still prefer to name a vision-capable profile as your uncensored fallback, and there is every reason to: a described picture is a summary, and the model that reads the original will always have more to go on.

## The Per-Chat Concierge Switch

Every chat keeps a small brass switch in the sidebar — found under the **Chat** section of the Chat Sidebar — with three positions: **Moderated**, **Unmoderated** and **Locked**. It is where a chat's relationship with the Concierge is adjusted, reconsidered, or — should the operator so insist — settled for good.

The same three positions are also offered on the **new-chat form**, above **Starting Scenario**, for the conversations whose character is not in doubt before they begin. A posture chosen there is in force from the very first word: the Concierge posts his note at the top of the fresh history, and the opening greeting is composed under the arrangement rather than discovering it after a refusal. See [Chats Overview](chats.md) for the particulars. Everything below applies identically whichever of the two controls you reached for.

| Position | Text, errands and pictures | When a provider refuses | May the Concierge move it? |
|---|---|---|---|
| **Moderated** (default) | the usual providers first | he takes it to the uncensored desk (under Auto-Route) | yes, to Unmoderated |
| **Unmoderated** | the uncensored desk only, prompts written candidly | — (already there) | no |
| **Locked** | the usual providers only | the refusal stands | no |

### Moderated

The default footing, and where every chat begins. The house's usual providers are asked first; should one of them decline a matter on grounds of propriety, the Concierge quietly carries it across the street to the uncensored desk (under **Auto-Route**) and leaves a note saying so. If the refusals pile up, or the classifier reads the conversation and finds it spirited, he moves the whole chat to Unmoderated himself and announces it. Returning a chat here by hand clears his ledger of refusals and his classifier's verdict, so the matter is considered afresh. (In earlier editions this position was labelled *Monitored*, and before that *Safe*.)

### Unmoderated

The chat goes to the uncensored desk and nowhere else: text traffic, background errands — memory extraction, title revisions, story backgrounds — and pictures, with prompts drafted candidly. Nothing is classified or scanned, since there is nothing left to decide. This position works even when the global Concierge mode is **Off** — asking for the uncensored desk on one chat should not require throwing a global switch first — though it does require an uncensored provider to be configured under *Uncensored Providers* above.

A chat arrives here in one of two ways, and the sidebar, the header pill and the list mark all say which:

- **You put it here.** *"You have opened the uncensored door yourself."* If the classifier keeps calling a spicy chat safe and you are tired of arguing with it, this is the position you want.
- **The Concierge put it here** — after too many refusals, or on reading the conversation. *"The Concierge moved this chat to the uncensored desk after two refusals. Set it back to Moderated if you disagree."* Choosing Unmoderated yourself on such a chat simply takes the decision as your own; nothing is announced, and nothing about the routing changes.

(In earlier editions this position was two: *Flagged*, for the Concierge's verdict, and *Uncensored*, for yours. They took the same road and differed only in who had sent them down it, which is now a note rather than a position.)

### Locked

Only the usual providers, ever. **No moderation occurs** — nothing is classified or scanned — and if a provider refuses, the refusal stands: the Concierge will not carry the matter elsewhere, and he will never move the chat of his own accord. He does post a note when a refusal stands, so you know it happened and why. Image prompts go out with their customary concealment. This is the position for the chat that must never reach an uncensored model — a shared or family conversation, say. (In earlier editions this position was labelled *Vouched Safe*, and before that *Off-duty*.)

### Where your chats landed

Every chat you had before this arrangement was placed where it would keep behaving as it did: a chat you had set **Uncensored** is now **Unmoderated** (by you); one you had **Vouched Safe** is **Locked**; one the Concierge had **Flagged** is **Unmoderated** (by the Concierge); and a **Monitored** chat is **Moderated**.

### Announcements and marks

Each change of position is announced in the chat history by the Concierge himself, in his customary voice, so the conversation's moderation provenance remains transparent on later re-readings. The Salon's header wears a small pill for any position other than Moderated — red for Unmoderated, grey for Locked — so a glance tells you whether anything other than the default is in force. Who set Unmoderated is in the pill's tooltip, never its colour. The very same shades mark a chat wherever it is merely *listed* — the homepage's Recent Chats, the Salon's roll of conversations, a character's Conversations, a project's chats — where the pill contracts to a modest asterisk beside the message count. Moderated, being the arrangement everyone already assumes, wears nothing at all anywhere; rest the pointer on a mark or a pill and you will get the same explanation from each, since both are reading from the Concierge's one sheet of notes.

## Quick-Hide Integration

Chats that take the uncensored route can be hidden from the sidebar using the quick-hide system.

### Hiding Dangerous Chats

1. Click the **eye icon** in the sidebar footer
2. In the **Content Filters** section, toggle **"Dangerous Chats"** to hide them
3. Chats on the uncensored route will be hidden from the sidebar, projects section, and all-chats page

What the toggle hides is a matter of the *route*, not of anyone's opinion: every chat wearing the red mark — **Unmoderated**, whether by the Concierge's reckoning or by yours — goes behind the curtain, since it takes the spicy road. A **Locked** chat does not, however old and lurid a classification it may still be carrying about in its pocket — you said it was to stay with the usual desks, and the toggle takes you at your word. A **Moderated** chat, naturally, stays where it is.

The eye icon is always present in the sidebar footer, since its menu also carries the **Salon Images** toggle — see [Quick-Hide](quick-hide.md).

The toggle is persisted in your browser's local storage, so your preference is remembered across sessions.

## Automatic Background Classification

When dangerous content handling is enabled, Quilltap automatically classifies all existing chats in the background. This runs on startup and periodically every 10 minutes, ensuring legacy chats created before the feature was enabled also get classified.

- Chats with a context summary are classified directly from the summary
- Chats with no summary yet but a chosen scenario are classified from that scenario
- Longer chats with neither first have a summary generated, which then triggers classification
- Shorter chats with neither are classified from the raw message history
- Background classification runs at a lower priority than interactive tasks, so it won't slow down your active conversations

## Important Notes

- If you have an OpenAI connection profile, classification uses the free moderation endpoint (no token cost)
- Without an OpenAI profile, classification falls back to your Cheap LLM, adding a small token cost per scanned message
- Only user messages are scanned per-message, not assistant responses (and Unmoderated chats skip per-message scanning entirely)
- Chat-level classification uses the compressed context summary (covers the whole conversation), falling back to the chat's scenario before the first summary exists, and to the raw messages when there is no scenario either
- The system never blocks messages — if anything fails, your message goes through normally
- If no uncensored provider is available in Auto-Route mode, the message is sent to your regular provider with a warning
- Classification accuracy depends on the method used: the OpenAI moderation endpoint is purpose-built and highly accurate; the Cheap LLM fallback depends on the model's capabilities

## In-Chat Settings Access

Characters with help tools enabled can read your current dangerous content configuration during a conversation using the `help_settings` tool with `category: "chat"`. The chat category includes your dangerous content handling settings alongside other chat preferences. Ask a help-tools-enabled character something like "What are my dangerous content settings?" and it will look them up.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=chat&section=dangerous-content")`

## Related Topics

- [Chat Settings](chat-settings.md) - Configure global chat behavior
- [Connection Profiles](connection-profiles.md) - Set up LLM providers
- [Image Generation Profiles](image-generation-profiles.md) - Configure image providers
