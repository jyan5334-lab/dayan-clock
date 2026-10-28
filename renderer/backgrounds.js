window.timerBackgrounds = [
  {
    "id": "mountains",
    "label": "暗夜山峦",
    "src": "assets/backgrounds/mountains.webp"
  },
  {
    "id": "lunar",
    "label": "寂静月面",
    "src": "assets/backgrounds/lunar.webp"
  },
  {
    "id": "ocean",
    "label": "午夜海潮",
    "src": "assets/backgrounds/ocean.webp"
  },
  {
    "id": "vault",
    "label": "混凝土秘境",
    "src": "assets/backgrounds/vault.webp"
  },
  {
    "id": "basalt",
    "label": "熔岩余烬",
    "src": "assets/backgrounds/basalt.webp"
  },
  {
    "id": "forest",
    "label": "雨后深林",
    "src": "assets/backgrounds/forest.webp"
  },
  {
    "id": "silk",
    "label": "绯红绸幕",
    "src": "assets/backgrounds/silk.webp"
  },
  {
    "id": "crystal",
    "label": "冰晶棱镜",
    "src": "assets/backgrounds/crystal.webp"
  },
  {
    "id": "dunes",
    "label": "银月沙丘",
    "src": "assets/backgrounds/dunes.webp"
  },
  {
    "id": "city",
    "label": "雨夜都市",
    "src": "assets/backgrounds/city.webp"
  }
].map(item => ({ ...item, src: new URL(item.src, document.baseURI).href }));
