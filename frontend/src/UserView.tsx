import { useState, useEffect } from 'react';
import { Crown, Lock, CheckCircle2, AlertTriangle } from 'lucide-react';
import './index.css';

interface Plan {
  id: number;
  name: string;
  description: string | null;
  price: number;
  priceType: string;
  duration: number;
}

interface Channel {
  id: string;
  title: string;
  plans: Plan[];
}

const tg = (window as any).Telegram?.WebApp;

// Rubl summasini formatlash: 1313.54 → "1 313,54"
function formatRub(amount: number): string {
  return amount.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function UserView() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<number | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [activePayment, setActivePayment] = useState<any>(null);
  const [cardNumber, setCardNumber] = useState<string>('');
  const [uzsPerRub, setUzsPerRub] = useState<number>(155); // 1 RUB = X UZS
  const [promoCode, setPromoCode] = useState('');
  const [promoStatus, setPromoStatus] = useState<string | null>(null);
  const [complaintSent, setComplaintSent] = useState(false);
  const [complaintLoading, setComplaintLoading] = useState(false);

  const API_URL = import.meta.env.VITE_API_URL || '/api';

  // Kursni fetch qilish va har 25 daqiqada yangilash
  const fetchRate = () => {
    fetch(`${API_URL}/settings`)
      .then(res => res.json())
      .then(data => {
        if (data.cardNumber) setCardNumber(data.cardNumber);
        if (data.uzsPerRub && data.uzsPerRub > 0) setUzsPerRub(data.uzsPerRub);
      })
      .catch(err => console.error('Settings fetch error:', err));
  };

  useEffect(() => {
    if (tg) {
      tg.ready();
      tg.expand();
      document.documentElement.style.setProperty('--bg-color', tg.themeParams.bg_color || '#0b0c10');
      document.documentElement.style.setProperty('--text-main', tg.themeParams.text_color || '#f0f2f5');
    }

    fetch(`${API_URL}/channels`)
      .then(res => res.json())
      .then(data => {
        setChannels(data);
        if (data.length > 0 && data[0].plans.length > 0) {
          setSelectedChannel(data[0].id);
          setSelectedPlan(data[0].plans[0].id);
        }
        setLoading(false);
      })
      .catch(err => { console.error(err); setLoading(false); });

    // Dastlabki kurs
    fetchRate();

    // Har 25 daqiqada kursni yangilash
    const rateInterval = setInterval(fetchRate, 25 * 60 * 1000);
    return () => clearInterval(rateInterval);
  }, []);

  const [timeLeft, setTimeLeft] = useState<number>(180);

  useEffect(() => {
    if (!activePayment) return;
    const expiresAtTime = new Date(activePayment.createdAt).getTime() + 3 * 60 * 1000;
    const updateTimer = () => setTimeLeft(Math.max(0, Math.floor((expiresAtTime - Date.now()) / 1000)));
    updateTimer();
    const id = setInterval(updateTimer, 1000);
    return () => clearInterval(id);
  }, [activePayment]);

  // UZS → aniq RUB (2 decimal, joriy kurs bo'yicha)
  const calcRub = (uzs: number): number => Math.round((uzs / uzsPerRub) * 100) / 100;

  const handlePay = async () => {
    if (!selectedChannel || !selectedPlan || paying) return;
    setPaying(true);
    try {
      const userId = tg?.initDataUnsafe?.user?.id;
      const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      if (!userId && !isDev) {
        alert('Xatolik: Sahifani faqat Telegram ilovasi orqali oching!');
        return;
      }
      const res = await fetch(`${API_URL}/create-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: selectedChannel, planId: selectedPlan, userId: userId || 'dummy_user', promoCode: promoCode || undefined })
      });
      const data = await res.json();
      if (data.payment) {
        setActivePayment(data.payment);
      } else {
        alert("Xatolik: To'lov ma'lumotlarini olishning imkoni bo'lmadi.");
      }
    } catch (err) {
      console.error(err);
      alert("Xatolik yuz berdi. Qaytadan urinib ko'ring.");
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <div className="spinner"></div>
      </div>
    );
  }

  // To'lov sahifasida ko'rsatiladigan aniq rubl miqdori
  const paymentRub = activePayment
    ? (activePayment.rubAmount != null
        ? activePayment.rubAmount          // backenddan saqlangan aniq qiymat
        : calcRub(activePayment.amount))   // zahira hisob
    : 0;

  return (
    <>
      <div className="aurora-bg"></div>
      <header>
        <div className="logo-text">kassa bot</div>
        <div className="header-controls">
          <div className="icon-btn">✨</div>
          {tg?.initDataUnsafe?.user?.photo_url ? (
            <img src={tg.initDataUnsafe.user.photo_url} alt="Profile"
              style={{ width: 40, height: 40, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.1)' }} />
          ) : (
            <div className="icon-btn">{tg?.initDataUnsafe?.user?.first_name?.charAt(0) || 'U'}</div>
          )}
        </div>
      </header>

      <div className="title-container">
        <h1 className="gradient-title">Premium Obuna</h1>
        <p className="subtitle">Yopiq guruhlar va maxsus materiallarga kirish</p>
      </div>

      <main>
        {activePayment ? (
          /* ========== TO'LOV SAHIFASI ========== */
          <div className="cyber-card" style={{ padding: '20px', textAlign: 'center' }}>
            <h2 className="gradient-title" style={{ fontSize: '22px', marginBottom: '15px' }}>To'lov qilish</h2>
            <p style={{ marginBottom: '15px', fontSize: '14px', opacity: 0.9 }}>
              Iltimos, quyidagi karta raqamiga <b>aynan</b> ko'rsatilgan summani o'tkazing.
              Agar 1 tiyin (yoki kopeyk) kam yoki ko'p bo'lsa tizim avtomat qabul qilmaydi!
            </p>

            <div style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', padding: '15px', borderRadius: '12px', marginBottom: '15px' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Karta raqami:</div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', letterSpacing: '2px', userSelect: 'all', color: '#fff', marginTop: '4px' }}>
                {cardNumber || 'Admin karta kiritmagan!'}
              </div>
            </div>

            <div style={{ background: 'rgba(176, 38, 255, 0.1)', border: '1px solid var(--accent)', padding: '15px', borderRadius: '12px', marginBottom: '20px' }}>
              <div style={{ fontSize: '12px', color: 'var(--accent)' }}>To'lanadigan summa:</div>
              {/* UZS — aniq summa */}
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#fff', userSelect: 'all', textShadow: '0 0 10px rgba(176, 38, 255, 0.5)' }}>
                {activePayment.amount.toLocaleString('ru-RU')} UZS
              </div>
              {/* Rubl — aniq desimal qiymat, "≈" yo'q */}
              <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--accent-cyan)', marginTop: '6px', userSelect: 'all', letterSpacing: '0.5px' }}>
                {formatRub(paymentRub)} ₽
              </div>
            </div>

            {/* Countdown Timer */}
            <div style={{
              background: timeLeft > 30 ? 'rgba(0, 240, 255, 0.05)' : 'rgba(255, 0, 85, 0.05)',
              border: `1px dashed ${timeLeft > 30 ? 'rgba(0, 240, 255, 0.3)' : 'rgba(255, 0, 85, 0.3)'}`,
              padding: '12px 16px', borderRadius: '12px', marginBottom: '20px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all 0.3s ease'
            }}>
              <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: '500' }}>To'lov tugash muddati:</span>
              <span style={{
                fontSize: '18px', fontWeight: 'bold', fontFamily: 'monospace',
                color: timeLeft > 30 ? 'var(--accent-cyan)' : 'var(--accent-red)',
                textShadow: timeLeft > 30 ? '0 0 10px rgba(0, 240, 255, 0.4)' : '0 0 10px rgba(255, 0, 85, 0.4)'
              }}>
                {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
              </span>
            </div>

            {timeLeft === 0 && (
              <div style={{ color: 'var(--accent-red)', fontSize: '13px', fontWeight: '500', marginBottom: '15px' }}>
                ⚠️ To'lov muddati tugadi. "Ortga qaytish" tugmasini bosib qaytadan urinib ko'ring.
              </div>
            )}

            <button className="neon-btn" disabled={timeLeft === 0}
              onClick={() => {
                if (tg) { tg.showAlert("To'lov qilganingizdan so'ng bot sizga avtomatik ravishda havolani yuboradi. Kuting..."); tg.close(); }
                else alert("To'lovingiz tekshirilmoqda. Botga qayting.");
              }}>
              {timeLeft === 0 ? 'Vaqt tugadi' : "Men to'lov qildim"}
            </button>
            <button
              style={{ marginTop: '15px', background: 'transparent', border: 'none', color: 'var(--text-main)', opacity: 0.6, cursor: 'pointer' }}
              onClick={() => { setActivePayment(null); setComplaintSent(false); }}>
              {timeLeft === 0 ? 'Ortga qaytish' : 'Bekor qilish'}
            </button>

            {/* Complaint */}
            <button
              style={{
                marginTop: '12px',
                background: complaintSent ? 'rgba(0, 255, 102, 0.08)' : 'rgba(255, 0, 85, 0.06)',
                border: complaintSent ? '1px solid rgba(0, 255, 102, 0.25)' : '1px solid rgba(255, 0, 85, 0.2)',
                color: complaintSent ? 'var(--accent-green)' : 'var(--accent-red)',
                padding: '10px 16px', borderRadius: '10px',
                cursor: complaintSent || complaintLoading ? 'not-allowed' : 'pointer',
                fontSize: '12px', fontWeight: '500',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                opacity: complaintSent ? 0.7 : 1, transition: 'all 0.3s ease', width: '100%'
              }}
              disabled={complaintSent || complaintLoading}
              onClick={async () => {
                setComplaintLoading(true);
                try {
                  const userId = tg?.initDataUnsafe?.user?.id || 'unknown';
                  const res = await fetch(`${API_URL}/complaint`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: String(userId), paymentId: activePayment.id, amount: activePayment.amount })
                  });
                  if (res.ok || res.status === 429) setComplaintSent(true);
                  else { const d = await res.json(); alert(d.error || 'Xatolik yuz berdi'); }
                } catch { alert("Tarmoq xatoligi. Qaytadan urinib ko'ring."); }
                finally { setComplaintLoading(false); }
              }}>
              {complaintSent ? <><CheckCircle2 size={14} /> Shikoyat yuborildi</>
                : complaintLoading ? <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }}></div> Yuborilmoqda...</>
                : <><AlertTriangle size={14} /> To'lov tushmadimi? Shikoyat qilish</>}
            </button>
          </div>
        ) : (
          /* ========== OBUNA TANLASH SAHIFASI ========== */
          <>
            {channels.length === 0 ? (
              <div className="cyber-card" style={{ textAlign: 'center' }}>
                <p>Hozircha obunalar mavjud emas.</p>
              </div>
            ) : (
              <div className="channels">
                {channels.map((channel) => (
                  <div key={channel.id} className="cyber-card">
                    <div className="channel-header">
                      <div className="glass-icon"><Crown size={28} color="#fff" /></div>
                      <div className="channel-info" style={{ flex: 1 }}>
                        <h2 style={{ color: '#fff' }}>{channel.title}</h2>
                        <p><Lock size={12} color="var(--text-muted)" /> Yopiq hamjamiyat</p>
                      </div>
                      <div className="icon-btn" style={{ width: 32, height: 32 }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="3"></circle>
                          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                        </svg>
                      </div>
                    </div>

                    <div className="plans">
                      {channel.plans.map((plan) => (
                        <div
                          key={plan.id}
                          className={`plan-item ${selectedPlan === plan.id ? 'selected' : 'unselected'}`}
                          onClick={() => { setSelectedPlan(plan.id); setSelectedChannel(channel.id); }}>
                          <div>
                            <div className="plan-name">{plan.name}</div>
                            <div className="plan-desc">{plan.description}</div>
                          </div>
                          <div className="plan-price">
                            {/* UZS narxi */}
                            <div>{plan.price.toLocaleString('ru-RU')} UZS</div>
                            {/* Aniq rubl narxi — joriy kurs bo'yicha, desimal bilan */}
                            <div style={{ fontSize: '13px', color: 'var(--accent-cyan)', marginTop: '3px', fontWeight: '700' }}>
                              {formatRub(calcRub(plan.price))} ₽
                            </div>
                            {selectedPlan === plan.id && (
                              <CheckCircle2 size={20} color="#00ff66" style={{ marginLeft: 4, filter: 'drop-shadow(0 0 5px #00ff66)' }} />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="promo-container">
              <input
                className="cyber-input"
                placeholder="PROMO-KOD (IXTIYORIY)"
                value={promoCode}
                onChange={e => { setPromoCode(e.target.value); setPromoStatus(null); }}
              />
              <button type="button" className="btn-small-glow"
                onClick={async () => {
                  if (!promoCode || !selectedPlan) return;
                  try {
                    const res = await fetch(`${API_URL}/validate-promo`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ code: promoCode, planId: selectedPlan })
                    });
                    const data = await res.json();
                    if (data.valid) {
                      const rubVal = data.discountedRub != null ? data.discountedRub : calcRub(data.discountedPrice);
                      const discountLabel = data.discountType === 'percent'
                        ? `${data.discountValue}%`
                        : `${data.discountValue.toLocaleString('ru-RU')} UZS`;
                      setPromoStatus(`✅ ${discountLabel} chegirma! Yangi narx: ${data.discountedPrice.toLocaleString('ru-RU')} UZS (${formatRub(rubVal)} ₽)`);
                    } else {
                      setPromoStatus("❌ Promo-kod noto'g'ri yoki muddati tugagan");
                    }
                  } catch { setPromoStatus('❌ Tekshirishda xatolik'); }
                }}>
                <CheckCircle2 size={16} /> Tekshir
              </button>
            </div>
            {promoStatus && (
              <div style={{ fontSize: '13px', marginTop: '-14px', marginBottom: '20px', padding: '0 4px', color: promoStatus.startsWith('✅') ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                {promoStatus}
              </div>
            )}

            <button className="neon-btn" disabled={!selectedPlan || paying || channels.length === 0} onClick={handlePay}>
              {paying ? <div className="spinner"></div> : 'Obunani Faollashtirish'}
            </button>
          </>
        )}
      </main>

      <div className="tag-bottom">
        <div className="pill-tag">@KanalKassaBot</div>
      </div>
    </>
  );
}

export default UserView;
