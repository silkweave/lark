# TODO

## Edge Case Exploration - Mac Mini Deployment

- I'm planning to run `silkweave-lark` on my Mac Mini
- We have an Automation Suite there, which already has triggers to process requests (we can use webhooks)
- Now I'm thinking how we best wire this up
- I presume as long as the Automation Suite webhook contains the relevant metadata, the automation task (via claude -p) should be able to use the silkweave-lark MCP server to respond to the user.
- However, we've built this amazing Card Spinner view, so I'm not sure how to best wire this up, so the automation task ends up replacing the existing card correctly (I presume we need the card ID in metadata for the webhook endpoint)>
- I don't think we can really "respond" to the webhook here (as it's triggering a claude -p run), but maybe that's an option I could explore

## Attachment Handling

- I'd like to build the capability to send files (images, word, pdf, etc...) to our Agent.
- They need to be "sideloaded" (e.g. written to tmp storage on the target machine hosting the watcher), and referenced in the event / message stream
- This will be useful for AI agents to evaluate
- Example: I send an image of a cat, and ask "what animal is this"
