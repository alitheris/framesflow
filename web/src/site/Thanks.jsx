import React, { useEffect, useState } from 'react';
import { Heart } from 'lucide-react';
import SiteLayout from './SiteLayout';
import { useCloud } from '../cloud';
import { BRAND } from '../../../shared/brand.mjs';

export default function Thanks() {
  const { mcpUrl } = useCloud();
  const id = new URLSearchParams(location.hash.split('?')[1] || '').get('session_id');
  const [info, setInfo] = useState(null);
  useEffect(() => {
    if (!id || !mcpUrl) return;
    fetch(`${mcpUrl}/donate/session/${encodeURIComponent(id)}`).then(r => r.json()).then(setInfo).catch(() => {});
  }, [id, mcpUrl]);
  return (
    <SiteLayout title="Thank you" kicker="Contribution received">
      <p className="lead"><Heart size={20} style={{ verticalAlign: '-3px', color: '#d8f36a' }} /> {info?.paid && info.amount ? `Your $${Number(info.amount).toLocaleString('en-US')} contribution went through.` : 'Thanks for supporting Framesflow.'} It genuinely helps keep the studio free and improving.</p>
      <p>Stripe will email you a receipt. If anything looks wrong, contact us and quote the receipt number.</p>
      <div className="cards">
        <a className="card" href="#/studio"><b>Open the studio</b><span>Make something great.</span></a>
        <a className="card" href={BRAND.family[0].url} target="_blank" rel="noopener"><b>{BRAND.family[0].name}</b><span>{BRAND.family[0].tagline} Narrate your next video.</span></a>
      </div>
    </SiteLayout>
  );
}
