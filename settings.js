var DYD_SETTINGS = (() => {
  const STORAGE_KEY = 'dyd_settings';
  const AI_PROVIDERS = Object.freeze({
    deepseek: Object.freeze({id:'deepseek',label:'DeepSeek',keyField:'aiApiKey',baseUrl:'https://api.deepseek.com',model:'deepseek-v4-flash'}),
    ark: Object.freeze({id:'ark',label:'火山方舟',keyField:'arkApiKey',baseUrl:'https://ark.cn-beijing.volces.com/api/v3',model:'ep-20260130101355-jzs66'}),
  });
  const DEFAULTS = Object.freeze({aiProvider:'deepseek',aiApiKey:'',arkApiKey:'',supadataApiKey:'',volcApiKey:'',transcriptionProvider:'volc',volcResourceId:'volc.bigasr.auc'});
  const cleanKey = value => typeof value === 'string' ? value.trim() : '';
  function normalize(input = {}) {
    return {...DEFAULTS,
      aiProvider:input?.aiProvider==='ark'?'ark':'deepseek',
      aiApiKey:cleanKey(input?.aiApiKey),arkApiKey:cleanKey(input?.arkApiKey),
      volcApiKey:cleanKey(input?.volcApiKey),
      transcriptionProvider:input?.transcriptionProvider==='supadata'?'supadata':'volc',
      volcResourceId:input?.volcResourceId==='volc.seedasr.auc'?'volc.seedasr.auc':'volc.bigasr.auc',
      supadataApiKey:cleanKey(input?.supadataApiKey)};
  }
  function selectedAi(input = {}) {
    const settings=normalize(input),provider=AI_PROVIDERS[settings.aiProvider];
    return {...provider,apiKey:settings[provider.keyField],chatCompletionsUrl:`${provider.baseUrl}/chat/completions`};
  }
  return {STORAGE_KEY,AI_PROVIDERS,DEFAULTS,normalize,selectedAi};
})();
if(typeof module !== 'undefined') module.exports=DYD_SETTINGS;
