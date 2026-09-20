-- Company logos.
--
-- Fetched once by a worker and stored in Supabase Storage, rather than hot-linked
-- from a favicon service. Hot-linking would tell that service, on every page
-- view, exactly which companies she is tracking.

alter table jobhunt.companies add column if not exists domain text;
alter table jobhunt.companies add column if not exists logo_path text;
alter table jobhunt.companies add column if not exists logo_checked_at timestamptz;

-- Logos are public brand assets, so a public bucket keeps rendering simple and
-- avoids minting a signed URL per row. Nothing private is ever put here.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 262144,
        array['image/png','image/x-icon','image/vnd.microsoft.icon','image/jpeg','image/svg+xml','image/webp'])
on conflict (id) do update set public = true;

-- Known domains for the companies that matter to her. The worker guesses
-- `<slug>.com` for the rest and simply records a miss when that fails.
update jobhunt.companies set domain = v.domain
from (values
  ('supabase','supabase.com'), ('clickhouse','clickhouse.com'), ('clickhouseinc','clickhouse.com'),
  ('docker','docker.com'), ('vercel','vercel.com'), ('n8n','n8n.io'), ('camunda','camunda.com'),
  ('gitlab','gitlab.com'), ('makersite','makersite.io'), ('secfix','secfix.com'),
  ('domino-data-lab','dominodatalab.com'), ('domino data lab','dominodatalab.com'),
  ('pliant','getpliant.com'), ('tilla','tilla.io'), ('attio','attio.com'),
  ('intellias','intellias.com'), ('stripe','stripe.com'), ('nvidia','nvidia.com'),
  ('revizto','revizto.com'), ('kombo','kombo.dev'), ('enfuce','enfuce.com'),
  ('engflow','engflow.com'), ('hypatos','hypatos.ai'), ('trimble','trimble.com'),
  ('nerdio','getnerdio.com'), ('concentrix','concentrix.com'), ('fordefi','fordefi.com'),
  ('sauce-labs','saucelabs.com'), ('saucelabs','saucelabs.com'), ('dxc','dxc.com'),
  ('dxctechnology','dxc.com'), ('thermo-fisher-scientific','thermofisher.com'),
  ('hamilton-medical','hamilton-medical.com'), ('metabolon','metabolon.com'),
  ('securitybridge','securitybridge.com'), ('napster','napster.com'),
  ('everreal','everreal.co'), ('medifox-dan','medifoxdan.de'), ('wilken','wilken.de')
) as v(slug, domain)
where jobhunt.companies.slug = v.slug and jobhunt.companies.domain is null;
