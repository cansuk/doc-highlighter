# Markdown test page

This file exists to try Notestark on. The text in it is deliberately made of different
structures: paragraphs, lists, a table, code and a quote.

## Selection inside one element

This whole paragraph is a single block of text. It is the easiest case for a highlight:
the selection starts and ends inside the same block. Try selecting this sentence from
beginning to end.

## Selection across elements

The hard case is this: when a selection **starts in one block** and ends in another, the
DOM wrapping approach produces *nested* structures. Start dragging from the middle of
this paragraph and stop at the second item of the list below.

- First item — short.
- Second item — try ending the selection here.
- Third item — leave this one out.

## Repeated text

The sneakiest problem in anchoring: telling which occurrence was highlighted when the
same text appears several times on a page. The word `status` appears three times in the
rows below.

| Field  | Description                          |
|--------|--------------------------------------|
| status | The application's current status      |
| status | The status code of the payment        |
| status | The certificate's status history      |

> A highlight that does not land in the same place when the page is reloaded is not a
> highlight. It is a colour someone saw once.

## Long text

Everything from here down is filler, so that there is a region which needs scrolling.
A highlight ending up outside the visible area after a reload — where the reader cannot
find it — is a separate UX problem from whether it was restored at all.

To test the content hash: copy this file and rename the copy. As long as the hash is
unchanged, the highlights should appear in the new file too. Then add a word to this
paragraph — the hash changes, and fallback anchoring has to take over.

```js
// code block — selection has to work in here as well
const key = await sha256(document.body.innerText);
```
