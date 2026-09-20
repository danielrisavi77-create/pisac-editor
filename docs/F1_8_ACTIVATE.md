# F1-8 Activate — runbook

**Datum:** 20. rujna 2026.  
**Status:** IN_PROGRESS (Supabase project restored this session)  
**Owner:** Daniel Rišavi  
**Project ref:** `cxwxxcwrgushfkisfpxz` (eu-central-1)

## Slot juggling (free plan, 2 active)

To restore Pisac this session:

1. Paused `Lekta staging` (`bnyemcnsphlitjradrst`)
2. Restored `Pisac` (`cxwxxcwrgushfkisfpxz`)

`Lekta` production (`zrrjttizjyfcxmcpgzml`) was left ACTIVE. Restore Lekta staging after Pisac env is captured if needed.

## Checklist

- [x] Restore Pisac project
- [ ] Wait until status = `ACTIVE_HEALTHY`
- [ ] Apply migrations `2026091904`, `2026091905`, `2026091906` (skip AI Architect 1901/1903 in F1)
- [ ] Fetch publishable/anon key
- [ ] Set `NEXT_PUBLIC_SUPABASE_URL=https://cxwxxcwrgushfkisfpxz.supabase.co`
- [ ] Set `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] Set `NEXT_PUBLIC_SITE_URL` to the public origin
- [ ] Auth → URL configuration: allow `/auth/callback` with query
- [ ] Deploy (Netlify existing / Vercel if team exists)
- [ ] Authenticated E2E
- [ ] Flip fixture evidence toward PASS

## Auth redirect allowlist

Must permit:

```
https://<origin>/auth/callback
```

and local:

```
http://localhost:3000/auth/callback
```

## Honest limit

Definition ≠ PASS. Applying schema does not mark FX-FR-* PASS until bound evidence exists (SHA + env + result + artifact).
