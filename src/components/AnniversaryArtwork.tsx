/** 原创纪念装饰：环形轨迹与校园建筑意象，不使用学校官方标识。 */
export function AnniversaryArtwork() {
  return (
    <div className="anniversary-artwork" aria-hidden="true">
      <span className="anniversary-numeral">120</span>
      <svg viewBox="0 0 800 180" preserveAspectRatio="xMidYMax slice">
        <g fill="none" stroke="currentColor" strokeWidth="0.8">
          <circle cx="390" cy="-25" r="245" />
          <circle cx="390" cy="-25" r="260" />
          <circle cx="390" cy="-25" r="275" strokeDasharray="2 5" />
          <path d="M0 169h800M0 175h800M20 168v-54l43-27 43 27v54M28 114h70M48 168v-35a15 15 0 0 1 30 0v35M130 168V98h98v70M140 98V77l39-25 39 25v21M155 168v-39h48v39M260 168V116h146v52M274 116V99h118v17M294 99V85h78v14M286 168v-32h20v32M322 168v-32h20v32M358 168v-32h20v32M440 168V84h86v84M450 84V67h66v17M458 67V52h50v15M450 105h66M450 124h66M450 143h66M558 168v-47l35-30 35 30v47M570 168v-28a23 23 0 0 1 46 0v28M656 168v-62h124v62M664 106V88h108v18M674 168v-41h17v41M710 168v-41h17v41M746 168v-41h17v41" />
          <path d="M35 119v12m57-12v12M147 108v12m64-12v12M147 135v12m64-12v12M467 92v13m16-13v13m16-13v13M467 111v13m16-13v13m16-13v13M467 130v13m16-13v13m16-13v13" />
        </g>
      </svg>
    </div>
  );
}
