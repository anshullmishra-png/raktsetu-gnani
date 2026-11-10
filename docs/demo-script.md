# 60-second demo script

Open https://raktsetu-gnani.vercel.app/hospital before you start recording.
Have one clip ready to upload, or be ready to speak the bank's reply yourself.
Timings are targets; the search step takes about 20 seconds, so talk over it.

| Time | On screen | Say |
|---|---|---|
| 0:00 | Hospital page, form empty | "The portal says this blood bank has four units of O negative. It was last updated thirty-one hours ago. The bank actually ran out yesterday. Somebody is about to drive across Bengaluru for nothing." |
| 0:10 | Pick Namma Arogya Hospital, O-, 2 units. Press **Find blood** | "RaktSetu is the step in between. I give it a blood group, a unit count and my hospital. No patient details, ever." |
| 0:16 | Call log and map filling in | "It finds every compatible bank within eighty kilometres. For O negative that means O negative only, and that rule is code, not the model. It checks each listing. Watch the stale ones fail." |
| 0:28 | Proposed holds appears | "It doesn't reserve anything. It proposes, and I decide." Press **Approve hold**. "Now two units are held for thirty minutes." |
| 0:36 | Voice panel: tick consent, upload or record "Sorry, we ran out of O negative yesterday. We cannot supply." | "Then I hear it from the bank. They're told it's an AI and that they're being recorded, and they agree. Their reply goes through Gnani Prisma." |
| 0:46 | Transcript and result appear; hold flips to Cancelled | "Prisma's transcript: they ran out. The hold is cancelled and the units go back, before anyone leaves the building." |
| 0:53 | Switch to Admin, show kill switch and audit log | "Every step is in an audit log nobody can edit, and one switch stops all of it." |
| 0:58 | Back to landing page | "RaktSetu. All data here is synthetic." |

Notes for recording:

- If the bank you held is not the one you want to speak for, pick it in the
  "Blood bank" dropdown in step 4 first.
- The reply clip must name the same blood group as the request (O negative
  here). A reply about a different group is flagged for review, not acted on.
- Tick the consent box only after the disclosure text is on screen. The
  "Read aloud" button uses the browser's voice, not Gnani; skip it in a
  60-second cut.
- For a second take, run `node --env-file=.env scripts/apply-db.mjs` to reset
  stock to the starting state.
