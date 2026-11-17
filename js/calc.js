/* ============================================================
 * calc.js — 规格公式解析 + 优惠计算
 * ------------------------------------------------------------
 * 用户只填「原始规格」，自动算出总数量（含份数、赠品）；
 * 优惠文本自动换算成「到手价」，比价一律用到手价。
 * ============================================================ */
(function (global) {
  'use strict';

  // 品类对应的单位关键词
  const UNIT_HINT = {
    milk:   { unit: '克', label: '每克', re: /(\d+(?:\.\d+)?)\s*(?:g|克)/i },
    diaper: { unit: '片', label: '每片', re: /(\d+(?:\.\d+)?)\s*片/ },
    fuel:   { unit: '升', label: '每升', re: null }
  };

  /* 解析规格文本为结构化信息
   * 支持写法：
   *   800g/罐           → 每罐800克，1份，共800克
   *   800g×3罐           → 每罐800克，3份，共2400克
   *   58片×3包           → 每包58片，3份，共174片
   *   800g×2罐+赠1罐     → 每罐800克，2份+1赠品，共2400克
   *   58片/包×3包+送1包  → 每包58片，3份+1赠品，共232片
   * 返回 { per, packs, gift, total, unit, label, ok, text }
   */
  function parseSpec(text, category) {
    const s = String(text || '').trim();
    const hint = UNIT_HINT[category] || { unit: '件', label: '每件', re: /(\d+(?:\.\d+)?)\s*(?:个|件|袋|包|罐)/ };

    // 加油：固定每升
    if (category === 'fuel') {
      return { per: 1, packs: 1, gift: 0, total: 1, unit: '升', label: '每升', ok: true, text: '按每升计价' };
    }

    // 每份数量：取第一个「数字+单位」
    const perMatch = s.match(hint.re);
    if (!perMatch) {
      return { per: 0, packs: 0, gift: 0, total: 0, unit: hint.unit, label: hint.label, ok: false, text: '未识别到规格数量' };
    }
    const per = parseFloat(perMatch[1]);

    // 份数：×N 或 xN，若没有则视为 1
    let packs = 1;
    const timesMatch = s.match(/[×x✕*]\s*(\d+(?:\.\d+)?)/i);
    if (timesMatch) packs = parseFloat(timesMatch[1]);

    // 赠品：+赠N / +送N / 赠N / 送N
    let gift = 0;
    const giftMatch = s.match(/(?:\+\s*)?(?:赠|送)\s*(\d+(?:\.\d+)?)/);
    if (giftMatch) gift = parseFloat(giftMatch[1]);

    // 总数量 = 每份 × (份数 + 赠品份数)
    const total = per * (packs + gift);
    const parts = [];
    parts.push(`${per}${hint.unit}/份`);
    if (packs !== 1 || gift > 0) parts.push(`${packs}份`);
    if (gift > 0) parts.push(`赠${gift}份`);
    parts.push(`共${round(total)}${hint.unit}`);

    return { per, packs, gift, total: round(total), unit: hint.unit, label: hint.label, ok: true, text: parts.join(' · ') };
  }

  function round(n) { return Math.round(n * 10000) / 10000; }

  /* 计算优惠后的到手价
   * 支持：
   *   满199减30 / 满200-30  → 满减（price达门槛才减）
   *   9折 / 9.5折 / 95折    → 折扣（>10视为百分数，如95折=9.5折）
   *   减20 / 立减20 / -20   → 直减
   *   无优惠 / 空           → 原价
   * 返回 { payable, saved, desc, applied }
   */
  function calcPayable(price, promo) {
    const p = Number(price) || 0;
    const s = String(promo || '').trim();
    if (!s || p <= 0) return { payable: p, saved: 0, desc: s || '无优惠', applied: false };

    // 满减：满X减Y / 满X-Y
    let m = s.match(/满\s*(\d+(?:\.\d+)?)\s*[-减]\s*(\d+(?:\.\d+)?)/);
    if (m) {
      const threshold = parseFloat(m[1]), cut = parseFloat(m[2]);
      if (p >= threshold) {
        const payable = Math.max(0, p - cut);
        return { payable: round(payable), saved: round(p - payable), desc: `满${threshold}减${cut}`, applied: true };
      }
      return { payable: p, saved: 0, desc: `满${threshold}减${cut}（未满）`, applied: false };
    }

    // 折扣：(\d)折 或 (\d\d)折（95折→9.5折）
    m = s.match(/(\d+(?:\.\d+)?)\s*折/);
    if (m) {
      let d = parseFloat(m[1]);
      if (d > 10) d = d / 10;   // 95 → 9.5
      if (d > 0 && d < 10) {
        const payable = p * d / 10;
        return { payable: round(payable), saved: round(p - payable), desc: `${d}折`, applied: true };
      }
    }

    // 直减：减20 / 立减20 / -20
    m = s.match(/(?:立)?减\s*(\d+(?:\.\d+)?)/) || s.match(/-\s*(\d+(?:\.\d+)?)/);
    if (m) {
      const cut = parseFloat(m[1]);
      const payable = Math.max(0, p - cut);
      return { payable: round(payable), saved: round(p - payable), desc: `减${cut}`, applied: true };
    }

    // 其它优惠文案（如"百亿补贴""会员价"）不参与计算，仅展示
    return { payable: p, saved: 0, desc: s, applied: false };
  }

  /* 由结构化字段计算规格总量（参考奶粉工具：购买 + 赠送）
   * buyPacks 购买份数、perPack 每份数量、giftPacks 赠送份数、giftPer 赠送单份数量
   */
  function buildSpecInfo(buyPacks, perPack, giftPacks, giftPer, category) {
    const hint = UNIT_HINT[category] || UNIT_HINT.diaper;
    if (category === 'fuel') {
      return { qty: 1, per: 1, packs: 1, gift: 0, giftPer: 0, unit: '升', label: '每升', ok: true, text: '按每升计价' };
    }
    const bp = Number(buyPacks) || 0;
    const pp = Number(perPack) || 0;
    const gp = Number(giftPacks) || 0;
    const gPer = Number(giftPer) > 0 ? Number(giftPer) : pp; // 赠送单份未填则同购买
    const buyTotal = bp * pp;
    const giftTotal = gp * gPer;
    const total = round(buyTotal + giftTotal);
    const ok = bp > 0 && pp > 0;
    const parts = [];
    parts.push(`${pp}${hint.unit}/份`);
    if (bp !== 1 || gp > 0) parts.push(`${bp}份`);
    if (gp > 0) parts.push(`赠${gp}份`);
    parts.push(`共${total}${hint.unit}`);
    return { qty: total, per: pp, packs: bp, gift: gp, giftPer: gPer, unit: hint.unit, label: hint.label, ok, text: ok ? parts.join(' · ') : '请填写购买份数与单份数量' };
  }

  /* 由消耗参数计算每日消耗量与可食用天数
   * consumption 结构：
   *   milk:   { times, spoons, gram }  → 每日克重 = times*spoons*gram
   *   diaper: { pcs }                  → 每日片数 = pcs
   *   fuel:   { liters }               → 每日升数 = liters
   * qtyInfo.qty 为该商品总数量
   * 返回 { daily, days, unit }  days 为 null 表示参数不足
   */
  function usableDays(qtyInfo, consumption, category) {
    const qty = (qtyInfo && qtyInfo.qty) || 0;
    const c = consumption || {};
    let daily = 0, unit = '克';
    if (category === 'milk') {
      const m = c.milk || {};
      daily = (Number(m.times) || 0) * (Number(m.spoons) || 0) * (Number(m.gram) || 0);
      unit = '克';
    } else if (category === 'diaper') {
      const d = c.diaper || {};
      daily = Number(d.pcs) || 0;
      unit = '片';
    } else if (category === 'fuel') {
      const f = c.fuel || {};
      daily = Number(f.liters) || 0;
      unit = '升';
    }
    const days = (qty > 0 && daily > 0) ? round(qty / daily) : null;
    return { daily: round(daily), days, unit };
  }

  global.PriceCalc = { parseSpec, buildSpecInfo, calcPayable, usableDays, round };
})(window);
