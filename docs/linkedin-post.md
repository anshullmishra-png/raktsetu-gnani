# LinkedIn post (draft)

The first real audio I sent through our project came back in lowercase, with no punctuation, and it broke my code.

Agnesh and I built RaktSetu for the Gnani.ai challenge. It checks whether a blood bank actually has the units its listing claims, because a portal can say "4 units of O negative" a full day after the shelf went empty. Gnani's Timbre voice opens the session by saying it's an AI, the bank answers out loud, Gnani's Prisma model transcribes it, and a person at the hospital approves any hold.

I had written the part that strips names out of transcripts to look for capital letters. Prisma doesn't give you capital letters. "Testname Demoperson" arrived as "test name demo person" and my filter caught one word of four. I only found out because I ran it instead of assuming.

That was the theme of the whole build. The number words I'd typed in for Hindi and Kannada are still unverified, and the README says so. I would rather ship a list of what I haven't tested than a number I made up.

Everything in the demo is synthetic and no real calls are placed.

Demo: https://raktsetu-gnani.vercel.app
Code: https://github.com/anshullmishra-png/raktsetu-gnani

#GreatIndianAIInternshipChallenge #GnaniAI
