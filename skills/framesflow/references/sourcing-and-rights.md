# Sourcing and rights

Framesflow can search and download footage and images quickly. That convenience does not remove the creator's responsibility: **the user is responsible for having the right to use every asset**. Help them do it properly. This is general information, not legal advice.

## Preferred sources, safest first
1. **Original material:** the user's own footage and screen recordings, original animations (`create_animation`, `add_animation`), original graphics.
2. **Public domain:** NASA, NOAA, Library of Congress, Internet Archive, national archives, museums that release to the public domain, Wikimedia Commons items marked public domain/CC0.
3. **Open licences (CC):** `search_images` defaults to licences that allow commercial use (Openverse). `search_youtube` with `license:"cc"` returns videos uploaded under Creative Commons Attribution. CC BY requires **credit**: Framesflow records creator, licence and URL in `sources.txt` (`export_package`); put those credits in the video description.
4. **Licensed stock and music:** libraries the user pays for or free libraries whose licence allows commercial use (check each).
5. **Permission:** ask the owner. Keep the reply.
6. **Fair use / fair dealing:** short clips used for criticism, commentary or news may qualify in some countries, but it is a legal defence decided case by case. Not a safe harbour; platforms still process claims automatically. Use sparingly, with real commentary, and never as the backbone of a channel.

## Rules for the AI
- Prefer rows 1–3 when choosing footage. Say which kind each clip is.
- Do not remove or hide a creator's watermark, logo or credit to disguise where a clip came from. If a clip is unusable because of burned-in branding, pick another clip.
- Record every source. Never invent a URL, time range or licence; mark unverified rows `UNVERIFIED`.
- Respect takedown requests and remove the clip.
- Be careful with: logos and trademarks, music (even a few seconds), recognisable people (privacy/publicity rights), minors, news footage owned by agencies, sports, films and TV.
- Do not generate or present synthetic media as real footage of real events; follow platform disclosure rules for realistic synthetic content.

## YouTube specifics
- Monetisation policy rejects mass-produced/repetitive content and reused content without original value. A video of other people's clips with a voiceover is at risk unless the narration and structure add real original commentary, analysis or story. Prefer original research and mostly original or licensed visuals.
- Copyright strikes remove videos and can end a channel after repeated strikes. Content ID claims can redirect or block revenue.
- Downloading YouTube videos may breach YouTube's Terms of Service even when the licence is permissive; the user decides, and uses the tool at their own risk. Prefer sources that offer downloads officially (Internet Archive, Wikimedia, NASA, stock libraries).

## Images and cut-outs
- `search_images` returns title, creator, licence and URL for each result. Pass them as `credit` to `import_image` so they are saved.
- `remove_background` produces a transparent PNG; the cut-out keeps the original's licence and credit. A cut-out of a copyrighted photo is still that photo.

## Voice and music
- AI voices: check the provider's licence covers commercial use. Kuku Labs (kukulabs.online) offers AI voiceovers with plans for creators; read their terms for commercial rights and cloning consent.
- Voice cloning: only clone a voice with the speaker's consent.
- Music: use tracks you own or that are licensed for monetised video. Keep the licence receipt.

## Before publishing
1. Open `sources.txt` from `export_package`: every source has a line.
2. Credits are in the description.
3. Nothing in the video relies on someone else's work without a right to use it.
