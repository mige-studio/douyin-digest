var DYD_SETTINGS = (() => {
  const STORAGE_KEY = 'dyd_settings';
  const DEFAULTS = Object.freeze({aiApiKey:'',supadataApiKey:'',volcApiKey:'',transcriptionProvider:'volc',volcResourceId:'volc.bigasr.auc',aiBaseUrl:'https://api.deepseek.com',aiModel:'deepseek-v4-flash'});
  function normalize(input = {}) {
    return {...DEFAULTS, aiApiKey:typeof input?.aiApiKey==='string'?input.aiApiKey.trim():'',
      volcApiKey:typeof input?.volcApiKey==='string'?input.volcApiKey.trim():'',
      transcriptionProvider:input?.transcriptionProvider==='supadata'?'supadata':'volc',
      volcResourceId:input?.volcResourceId==='volc.seedasr.auc'?'volc.seedasr.auc':'volc.bigasr.auc',
      supadataApiKey:typeof input?.supadataApiKey==='string'?input.supadataApiKey.trim():''};
  }
  return {STORAGE_KEY,DEFAULTS,normalize,chatCompletionsUrl:()=>`${DEFAULTS.aiBaseUrl}/chat/completions`};
})();
if(typeof module !== 'undefined') module.exports=DYD_SETTINGS;
