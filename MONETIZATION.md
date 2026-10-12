# Ads and affiliate links

The site ships with ads and affiliate links wired in, but **switched off** until you add your own IDs. With no IDs set, no ad code loads and nothing changes for visitors.

## Where ads appear

| Game | Banner (display ad) | Full-screen ad between rounds | Affiliate gear shelf |
|---|---|---|---|
| Dunes Arena (Unity) | Lobby page | When you exit a match; the game can also request breaks | Gaming gear |
| Cricket (Unity) | Lobby page | End of innings and match (once the game is merged) | Cricket kit |
| VOLT RIOT | Menu and results | "Next round" / "Menu" on the results screen | Racing setup |
| BOGEY BRAWL | Menu and results | "Play again" / "Menu" on the results screen (solo only, so online players stay in sync) | Golf at home |
| Sports Complex | Menu | "Back to menu" | Sports gear |
| Plush Panic | Menu and results | Between Shows (once the game is merged) | Party night picks |

Ads never cover live gameplay. That's an AdSense policy, and it also keeps the games playable.

## What you need to set up

1. **Your domain, shreyanshsharan.com.** AdSense only approves sites on a domain you own, so the site must be served from it rather than a `*.github.io` or `*.vercel.app` address. Connect it to whichever host you use:
   - **Vercel:** Project → Settings → Domains → add `shreyanshsharan.com` and `www.shreyanshsharan.com`, then add the DNS records Vercel shows at your domain registrar.
   - **GitHub Pages:** repo Settings → Pages → Custom domain → `shreyanshsharan.com`, tick **Enforce HTTPS**, and at your registrar add A records for `@` pointing to 185.199.108.153, 185.199.109.153, 185.199.110.153 and 185.199.111.153, plus a CNAME for `www` pointing to `shreyansh-sharan.github.io`.
   - Use only one of the two for the domain.
2. **Google AdSense.**
   - Sign up at adsense.google.com, add your domain and wait for approval (often a few days to a few weeks).
   - Create a display ad unit and copy its slot ID.
   - Turn on **Privacy & messaging → European regulations** so Google shows the consent banner for EU/UK visitors.
3. **H5 games ads (optional, for full-screen ads between rounds).** Apply for the AdSense H5 Games Ads program. Until it's approved, leave `VITE_H5_GAME_ADS=off`; the banners still work.
4. **Amazon Associates.** Join the program for your store (affiliate-program.amazon.in for India, affiliate-program.amazon.com for the US) and copy your tracking ID, such as `yourname-21`. Amazon closes accounts that make no qualifying sales within 180 days.
5. **Add the IDs.** Copy `site/.env.example` to `site/.env.local` for local builds. For the live site, add the same variables wherever the site is deployed: in GitHub (Settings → Secrets and variables → Actions → **Variables**) for the GitHub Pages workflow, and/or in Vercel (Project → Settings → Environment Variables). Then redeploy.

```
VITE_ADSENSE_CLIENT=ca-pub-XXXXXXXXXXXXXXXX
VITE_ADSENSE_SLOT_LOBBY=XXXXXXXXXX
VITE_H5_GAME_ADS=on
VITE_AMAZON_TAG=yourname-21
VITE_AMAZON_DOMAIN=amazon.in
```

The build writes `ads.txt` automatically from your publisher ID.

## What 100 daily players might earn

These are rough planning numbers, not a promise. Real earnings depend on where visitors come from, the device, the season and your AdSense approval. Advertisers pay several times more for US/UK visitors than for Indian visitors.

**Assumptions:** 100 players a day, about 3 pages each (300 page views), about 10 minutes of play with 2 between-round ad opportunities each, and about 60% of ad requests filled.

| Source | How it's worked out | Mostly Indian visitors | Mostly US/UK visitors |
|---|---|---|---|
| Banners | 300 page views × page RPM of $0.30–$3 per 1,000 | ~$0.10/day | ~$0.90/day |
| Between-round ads | 120 filled ads × eCPM of $0.50–$6 per 1,000 | ~$0.06/day | ~$0.70/day |
| Rewarded ads (cricket extra review) | ~20 views × $2–$15 per 1,000 | ~$0.04/day | ~$0.30/day |
| Amazon affiliate | ~2–4 clicks, ~3% buy, 3–9% commission on a ~₹2,500/$40 order | ~$0.05/day | ~$0.15/day |
| **Total** | | **~$0.25/day (~$8/month)** | **~$2/day (~$60/month)** |

What that means:
- At 100 players a day, expect roughly **$8–60 a month**. AdSense pays out once you pass $100, so the first payment could take a few months to over a year.
- Earnings scale with traffic. 1,000 players a day is roughly $80–600 a month, and 10,000 a day is roughly $800–6,000 a month.
- Ad blockers (often 20–40% of gamers) reduce all of these numbers.
- The things that move revenue most are more visitors, longer sessions, and a share of traffic from higher-paying countries. More ad units per page don't help much, and they risk policy problems.
