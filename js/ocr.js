/* ============================================================
 * ocr.js — 截图识别（Tesseract.js 中文 OCR，完全离线版）
 * ------------------------------------------------------------
 * 引擎、wasm 核心、中文模型均随 App 一起部署（vendor/ 目录），
 * 首次打开即从本地加载，识别全程无需联网。
 * 若本地文件缺失，自动回退到 CDN 兜底。
 * 识别结果仅作候选，需用户确认后填入表单。
 * ============================================================ */
(function (global) {
  'use strict';

  // 本地资源路径（基于 baseURI 拼绝对地址，兼容 GitHub Pages 子路径）
  const LOCAL = {
    engine: new URL('vendor/tesseract/tesseract.min.js', document.baseURI).href,
    worker: new URL('vendor/tesseract/worker.min.js', document.baseURI).href,
    coreDir: new URL('vendor/tesseract/', document.baseURI).href.replace(/\/$/, ''),
    langDir: new URL('vendor/tesseract/lang', document.baseURI).href.replace(/\/$/, '')
  };
  // CDN 兜底（本地文件缺失时）
  const CDN = {
    engine: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
    worker: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
    coreDir: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
    langDir: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/chi_sim@1.0.0/4.0.0_best_int'
  };
  let loadPromise = null;
  let usingLocal = null; // 记录最终用的是本地还是 CDN

  function injectScript(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.async = true;
      s.onload = () => (global.Tesseract ? resolve() : reject(new Error('引擎未就绪')));
      s.onerror = () => reject(new Error('脚本加载失败'));
      document.head.appendChild(s);
    });
  }

  function loadTesseract(onStatus) {
    if (global.Tesseract) return Promise.resolve(global.Tesseract);
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      onStatus && onStatus('正在加载识别引擎…');
      try {
        // 优先本地引擎（离线）
        await injectScript(LOCAL.engine);
        usingLocal = true;
      } catch (e) {
        // 本地失败 → 回退 CDN
        onStatus && onStatus('本地引擎缺失，改用在线引擎…');
        try {
          await injectScript(CDN.engine);
          usingLocal = false;
        } catch (e2) {
          throw new Error('识别引擎加载失败，请检查本地文件或网络');
        }
      }
      return global.Tesseract;
    })().catch(e => { loadPromise = null; throw e; });
    return loadPromise;
  }

  function isLocal() { return usingLocal === true; }

  // 识别图片，返回原始文本
  async function recognize(file, onStatus) {
    const T = await loadTesseract(onStatus);
    onStatus && onStatus(usingLocal ? '正在加载内置中文模型…' : '正在准备中文识别模型…');
    const base = usingLocal ? LOCAL : CDN;
    let worker;
    try {
      worker = await T.createWorker('chi_sim', 1, {
        workerPath: base.worker,
        corePath: base.coreDir,
        langPath: base.langDir,
        gzip: true,
        logger: (m) => {
          if (m.status === 'recognizing text') {
            onStatus && onStatus('识别中… ' + Math.round((m.progress || 0) * 100) + '%');
          }
        }
      });
      const ret = await worker.recognize(file);
      return (ret && ret.data && ret.data.text) || '';
    } finally {
      if (worker) { try { await worker.terminate(); } catch (e) {} }
    }
  }

  // 常见品牌词库（用于从识别文本中匹配品牌）
  const BRANDS = {
    milk: ['爱他美', '飞鹤', '美赞臣', '惠氏', '雅培', '合生元', '君乐宝', '金领冠', '伊利', 'a2', '诺优能', '牛栏', '喜宝', '蓝臻', '启赋', '卓萃', '星飞帆'],
    diaper: ['帮宝适', '花王', '好奇', '尤妮佳', '大王', '雀氏', '安儿乐', '菲比', '妈咪宝贝', 'moony', '一级帮', '妙而舒', '小企鹅'],
    fuel: ['中国石化', '中石化', '中国石油', '中石油', '壳牌', '中国海油', '中海油', '民营加油站']
  };

  // 从识别文本提取候选字段
  function extractFields(text, category) {
    const raw = text || '';
    const compact = raw.replace(/\s+/g, '');
    const lines = raw.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);

    // 价格候选：¥数字 / 数字元 / 关键词后数字
    const prices = [];
    const patterns = [
      /[¥￥]\s*(\d{1,4}(?:\.\d{1,2})?)/g,
      /(\d{1,4}(?:\.\d{1,2})?)\s*元/g,
      /(?:到手价|券后价|券后|售价|实付|活动价|优惠价|秒杀价|价格)[^\d]{0,4}(\d{1,4}(?:\.\d{1,2})?)/g
    ];
    patterns.forEach(re => {
      let m;
      while ((m = re.exec(raw)) !== null) {
        const v = parseFloat(m[1]);
        if (v > 0 && prices.indexOf(v) < 0) prices.push(v);
      }
    });

    // 规格数量
    let qty = '';
    if (category === 'milk') {
      const m = compact.match(/(\d{2,4})(?:g|克)/i);
      if (m) qty = parseFloat(m[1]);
    } else if (category === 'diaper') {
      const m = compact.match(/(\d{1,3})片/);
      if (m) qty = parseFloat(m[1]);
    } else if (category === 'fuel') {
      qty = 1;
    }

    // 品牌匹配
    let brand = '';
    const dict = BRANDS[category] || [];
    for (let i = 0; i < dict.length; i++) {
      if (compact.toLowerCase().indexOf(dict[i].toLowerCase()) >= 0) { brand = dict[i]; break; }
    }

    // 商品名候选：优先含品牌的行，否则取较短的首行
    let name = '';
    if (brand) {
      const hit = lines.find(l => l.replace(/\s/g, '').toLowerCase().indexOf(brand.toLowerCase()) >= 0);
      if (hit) name = hit.replace(/\s+/g, ' ').slice(0, 40);
    }
    if (!name) {
      const cand = lines.find(l => l.length >= 2 && l.length <= 40 && !/^\d+(\.\d+)?$/.test(l)) || lines[0] || '';
      name = cand.replace(/\s+/g, ' ').slice(0, 40);
    }

    // 推荐主价格：优先"到手价/券后/售价"等关键词后的价格，其次第一个
    const keywordMatch = raw.match(/(?:到手价|券后价|券后|售价|实付|活动价|优惠价|秒杀价|价格)[^\d]{0,4}(\d{1,4}(?:\.\d{1,2})?)/);
    let mainPrice = '';
    if (keywordMatch) mainPrice = parseFloat(keywordMatch[1]);
    else if (prices.length) mainPrice = prices[0];

    return { raw: raw, lines: lines, prices: prices, qty: qty, brand: brand, name: name, mainPrice: mainPrice };
  }

  global.PriceOCR = { recognize, extractFields, isReady: () => !!global.Tesseract, isLocal };
})(window);
