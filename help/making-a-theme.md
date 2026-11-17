---
url: /calliope
---

# Making a Theme — from a Bare Wall to a Finished Room

> **[Open the Atelier](/calliope)**

This is the guided tour: one theme, made from start to finish, in the order a sensible person would make it. It assumes you know your way about Quilltap and have never once looked inside a theme. For the particulars of any single control, the reference is [Calliope's Atelier](theme-editor.md), and each step below says where in it to look.

Nothing here requires a text editor, a terminal or a strong constitution. An afternoon will do, and a pot of something hot.

## Before you begin: what a theme is

A theme is a short list of **decisions** — this colour for the page, that typeface for the headings — and Quilltap works out everything else from them. The decisions are called **tokens**. A theme states only what it changes; whatever it leaves unsaid keeps the house default, so a theme of twelve decisions is a perfectly respectable theme.

Whatever you are making lives in the Atelier as a **draft**. A draft changes nothing about the themes you have installed until you install it, so you may be as reckless as you please.

## 1. Begin

Open **Settings → Appearance** and press **Design a theme**, then **New theme**. Give it a name, and choose where to start:

- **A copy of** a theme you already admire is the kindest beginning. You inherit a working palette, its typefaces and its named values, and alter them until the thing is yours. The original is never touched.
- **A blank canvas** starts from the house default with nothing decided. Choose this when you know precisely what you want and would rather not unpick somebody else's opinions first.
- **Open a theme file** makes a draft of a `.qtap-theme` bundle someone sent you.

The moment the draft opens, **the whole of Quilltap puts it on**. That is the live preview, and it is the point of the exercise: open a chat beside the Atelier, in a split, and judge every choice where it will actually be worn. The Atelier's own panel keeps the house default, so no experiment, however dreadful, can hide the controls that would undo it.

More: [Drafts](theme-editor.md#drafts) and [The live preview](theme-editor.md#the-live-preview).

## 2. Name your palette

Resist, for a moment, the urge to start colouring things. First decide what your colours *are*.

The primitives keep a card of their own, and it is not in the list of sections down the left. Choose **Colours**, the first section in that list, if it is not chosen already (the eager will have clicked about by now), then scroll down the right-hand side, past every section of tokens, until you reach the folded card marked **Primitives**, and open it.

There, add the handful of values the theme is built from, each with a plain name of your own: `parchment`, `ink`, `brass`, `oxblood`. Five or six colours is plenty. A primitive is a value with a name, and tokens may **follow** it — so when you later decide the brass wants to be a shade warmer, you change it once and every surface that follows it changes too.

If you began from a copy, the primitives are already there. Read down them, and change their values before you change anything else; you will be astonished how much of the room repaints.

Each primitive may have a dark value of its own (**Dark apart**). Set them as you go, and flip between **Light** and **Dark** at the top of the draft to see both.

More: [Primitives](theme-editor.md#primitives).

## 3. Paint the walls

Now the tokens. The Atelier opens on **Essentials**, and within it the **Colours** section holds the two dozen decisions that govern the whole house. Take them in this order:

1. **Background** and **Foreground** — the page and the words on it. Everything else is judged against these.
2. **Card** and **Card foreground** — the raised surfaces: panels, settings cards, most of what you look at.
3. **Primary** and **Primary foreground** — the colour of the thing you are meant to press.
4. **Muted** and **Muted foreground** — quiet surfaces and secondary text.
5. **Accent**, **Border** and **Ring** — the quiet highlight, the lines between things, and the focus outline.
6. **Chat user** and **Chat user foreground** — your own bubble in the Salon.

For each, choose your primitive under **Follows** rather than typing a colour afresh. Most colours come in pairs, a surface and the text meant to sit on it; set both before you judge either.

Then visit **Sidebar colours** and **Chat surfaces**, which are the next most visible, and leave the rest until something looks wrong.

More: [Finding your way](theme-editor.md#finding-your-way) and [Each token](theme-editor.md#each-token).

## 4. Mind the contrast

As you set colours, rows will begin to grumble. A token that colours text is measured against the surface behind it, and the row shows the ratio: **4.5 to 1** for text, **3 to 1** for a focus ring. Beneath the draft's header is a running count of the pairs that fall short in the mode on show.

A warning never stops you saving or installing. It is, however, usually right, and the people most affected are the ones least likely to write and tell you. To clear one, darken or lighten *either* colour of the pair until the ratio passes — then check the other mode, because a pair that passes in light may fail in dark. A pair marked **Unchecked** sits on a gradient or an image the Atelier cannot measure; look at it with your own eyes.

More: [Each token](theme-editor.md#each-token), under **Contrast**.

## 5. Choose the type

A theme with its own typeface looks like a different application; a theme without one looks like the house in a new coat. Both are honourable.

To bring a face of your own, open **Fonts** and press **Add font**. Add all of a family's weights together. The Atelier reads each file and fills in the family, weight and style for you; correct anything it guessed. Then state the **licence**. This matters: a font is someone's work, and whoever shares a theme answers for the right to share the fonts inside it. Prefer faces under an open licence, and attach the licence text when you have it.

A font does nothing until a token names it. Go to **Font stacks** in the Essentials and put your family at the head of **Font sans**, **Font serif** or **Font brand**, with a sensible fallback behind it. A font nothing names is left out when the theme is installed, so there is no harm in uploading one you end up not using.

The **Type scale** section, close by, holds sizes, line heights and weights. Change these last and sparingly.

More: [Fonts](theme-editor.md#fonts).

## 6. Pictures, if any

Many fine themes carry no pictures at all. If yours wants a paper texture behind the page or a portrait on its card in the theme list, open **Images** and add it, then choose it with the image control of the token that should wear it. **Make it the preview** sets the picture shown beside the theme's name.

Give the Atelier your originals. The draft keeps them exactly as supplied, and the installed copy is tailored for travel by itself.

Should you wish to redraw Quilltap's icons — a large undertaking, and a satisfying one — that is the **Icons** section.

More: [Images](theme-editor.md#images) and [Icons](theme-editor.md#icons).

## 7. Look at everything

By now the theme looks handsome on whatever happens to be on your screen. The question is how it looks on what is not.

Press **Open the gallery**. **Calliope's Specimens** lays out every element a theme may dress, in every state it can take: the destructive button, the alert, the whisper, the dialog you see twice a year. Choose **Side by side** to see light and dark together, and scroll the lot. You are looking for the thing you forgot — the badge whose text has vanished, the input with no visible border.

When something is wrong and you cannot tell which token is to blame, press **Inspect** and click the offender. The inspector names every token that colours, borders, rounds and spaces it, and **Row** takes you straight to the one you want.

More: [The specimen gallery](theme-editor.md#the-specimen-gallery) and [Inspecting what you see](theme-editor.md#inspecting-what-you-see).

## 8. Go further, and know when to stop

Under **Components** every surface has decisions of its own: a card's padding, a bubble's corner, a scrollbar's thumb. Reach for these when one thing ought to differ from its fellows. If you find yourself changing the same value in six components, stop: you wanted an Essential, or a primitive, and the six will follow it.

**Choices**, at the head of the tokens, holds **Density**, which gives the whole house more or less room to breathe in a single stroke. Try both before you adjust any padding by hand.

Tick **Changed only** now and then. It shows what your theme actually says, and a short list is a sign of a theme that will age well.

More: [Choices](theme-editor.md#choices).

## 9. Custom CSS, for what tokens cannot say

Tokens dress most of a theme. A rule drawn above every card title, letters spaced just so, a lamp that flickers: these want CSS of your own. Open **Custom CSS** and press **Begin a stylesheet**.

Three things to know before you write a line:

- **Write against the hooks.** The **Reference** beside the editor lists the elements Quilltap publishes for the purpose, and the gallery prints each one's class name. A rule aimed at anything else may work today and break without notice.
- **Leave your theme's name out.** Every rule is fitted to your theme alone when it is loaded, and your animations are renamed so they never collide with the house's.
- **Fonts and pictures come from the draft.** `@import` and `@font-face` are not admitted, and a `url()` must name one of the draft's own images.

Use tokens inside your rules — the Reference inserts them as `var(--name)` — so that your CSS follows the palette instead of repeating it.

More: [Custom CSS](theme-editor.md#custom-css).

## 10. Ask Calliope

The muse the Atelier is named for attends in person. Press **Calliope** at the top of the draft and tell her what you are after: a whole mood, or one thing you would have different. A few matters of etiquette:

- **She proposes; you decide.** She is an assistant and not the author. Each suggestion arrives on a card, and nothing in your draft changes until you press **Keep**.
- **Try is free.** It dresses the window in the draft as it *would* be, and changes nothing until you stop trying.
- **A kept proposal is one Undo.** Change your mind and it is gone in a single step.
- **Her CSS obeys your rules:** catalogued hooks only, fitted to the theme like your own.
- **She cannot add files** or change the theme's particulars. Upload the font or the picture yourself, and she will gladly use it by name.
- **She cannot see the app.** To show her a fault, take a screenshot with enough of the page around it to tell where it is, attach it, and say what you want changed.
- **She is only as good as her engine.** Give her a model that permits tools and a generous allowance of output, and when a whole new look proves too much for one request, ask for one thing at a time.

A theme made with her help is an ordinary theme. Nothing in it records that she was consulted.

More: [Calliope herself](theme-editor.md#calliope-herself).

## 11. Finish and install

Open **Subsystems and details** and fill in the particulars: the author, the theme's licence, a few tags, and whether it **has a dark mode**. Write a **Description** at the top of the draft; it is what a stranger reads on the Appearance card.

Look once more at the counts beneath the header. Errors must be mended before the theme will install; warnings are yours to weigh. Then press **Install**.

The Atelier packs the draft and installs it exactly as an uploaded bundle would be, and Quilltap puts it on. Pictures become WebP and TrueType or OpenType fonts become WOFF2 in the installed copy, anything unused is left behind, and the draft keeps every original. The draft's version then moves on by one, so you may carry on working and install again whenever you like; each install replaces the last.

More: [Installing](theme-editor.md#installing).

## 12. Share it

To hand your theme to someone else, export the installed copy: in **Settings → Appearance**, press the theme's **Preview** button and then the export icon, and save the `.qtap-theme` file. Whoever receives it installs it with **Install Theme**, or opens it in their own Atelier to make something new of it.

Before you send it, read the fonts' licences one last time.

More: [Themes](themes.md), which also covers theme registries.

## Working outside the app

Those who prefer a text editor may have the same blank theme at the command line:

```bash
npx quilltap themes create "My Theme"
```

This writes `./my-theme/` with a `theme.json` and a `tokens.json`, the very pair a blank draft begins with. Check your work as you go:

```bash
npx quilltap themes validate ./my-theme
```

When you want to see it worn, zip the directory's contents as `my-theme.qtap-theme` and either install it or bring it into the Atelier with **Open a theme file**. The two ways of working mix freely: a draft's files may also be edited by hand in Quilltap General, under `Themes/`, and the Atelier reads them afresh.

More: [Themes](themes.md), under **Managing Themes via CLI**.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to the Atelier:

`help_navigate(url: "/calliope")`

## Related Help

- [Calliope's Atelier](theme-editor.md) — the reference for every section and control
- [Themes](themes.md) — themes, bundles, color modes and registries
- [Appearance Settings](appearance-settings.md) — choosing the theme you wear, and Calliope's settings
