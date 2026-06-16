/* shared/words.js — embedded 5-letter word list for Five (no external CDN).
 * ANSWERS: curated common words used as daily/practice solutions.
 * VALID adds a wider set of acceptable guesses (ANSWERS is a subset of VALID).
 */
(function (global) {
  'use strict';

  var ANSWERS = [
    'about','above','abuse','actor','acute','admit','adopt','adult','after','again',
    'agent','agree','ahead','alarm','album','alert','alike','alive','allow','alone',
    'along','alter','among','anger','angle','angry','apart','apple','apply','arena',
    'argue','arise','array','aside','asset','avoid','await','awake','award','aware',
    'badly','baker','basic','basis','beach','began','begin','being','below','bench',
    'birth','black','blade','blame','blank','blast','blind','block','blood','board',
    'boost','booth','bound','brain','brand','brave','bread','break','brick','bride',
    'brief','bring','broad','broke','brown','brush','build','built','buyer','cabin',
    'cable','calm','camera','candy','cargo','carry','catch','cause','chain','chair',
    'chalk','champ','chaos','charm','chart','chase','cheap','check','chest','chief',
    'child','china','choir','chose','civil','claim','class','clean','clear','climb',
    'clock','close','cloud','coach','coast','color','could','count','court','cover',
    'craft','crash','crazy','cream','crime','cross','crowd','crown','crude','cruel',
    'curve','cycle','daily','dance','dealt','death','debut','delay','depth','diary',
    'dirty','doubt','dozen','draft','drama','drank','dream','dress','dried','drink',
    'drive','drove','dying','eager','early','earth','eight','elite','empty','enemy',
    'enjoy','enter','entry','equal','error','event','every','exact','exist','extra',
    'faith','fault','favor','feast','field','fifty','fight','final','first','fixed',
    'flame','flash','fleet','flesh','float','flock','floor','fluid','focus','force',
    'forge','forth','forty','forum','found','frame','fresh','front','frost','fruit',
    'fully','funny','giant','given','glass','globe','glory','grace','grade','grain',
    'grand','grant','grape','graph','grasp','grass','great','green','greet','grief',
    'grill','grind','groom','gross','group','grown','guard','guess','guest','guide',
    'happy','harsh','heart','heavy','hello','hence','hobby','honor','horse','hotel',
    'house','human','humor','hurry','ideal','image','imply','index','inner','input',
    'irony','issue','ivory','japan','jelly','joint','jolly','judge','juice','jumbo',
    'knife','known','label','labor','laser','later','laugh','layer','learn','least',
    'leave','legal','lemon','level','light','limit','lobby','local','lodge','logic',
    'loose','lover','lucky','lunch','lying','magic','major','maker','march','match',
    'maybe','mayor','medal','media','metal','meter','might','minor','minus','mixed',
    'model','money','month','moral','motor','mount','mouse','mouth','movie','music',
    'naive','never','newly','niche','noble','noise','north','novel','nurse','occur',
    'ocean','offer','often','olive','onion','opera','orbit','order','organ','other',
    'ought','outer','owner','panel','panic','paper','party','pause','peace','phase',
    'phone','photo','piano','piece','pilot','pitch','pizza','place','plain','plane',
    'plant','plate','point','pound','power','press','pride','prime','print','prior',
    'prize','probe','proof','proud','prove','pulse','punch','pupil','purse','quart',
    'queen','query','quest','quick','quiet','quite','quote','radio','raise','rally',
    'ranch','range','rapid','ratio','reach','react','ready','realm','rebel','refer',
    'relax','reply','rider','ridge','rifle','right','rigid','rival','river','robot',
    'rocky','roman','rough','round','route','royal','rural','sadly','salad','sales',
    'sandy','scale','scare','scene','scent','scope','score','scout','scrap','screw',
    'sense','serve','seven','shade','shake','shall','shape','share','shark','sharp',
    'shelf','shell','shift','shine','shirt','shock','shoot','shore','short','shown',
    'sight','silly','since','sixth','sixty','sized','skill','sleep','slice','slide',
    'small','smart','smell','smile','smoke','snack','solid','solve','sorry','sound',
    'south','space','spare','spark','speak','speed','spend','spent','spike','spine',
    'spite','split','spoke','sport','spray','squad','staff','stage','stake','stamp',
    'stand','stark','start','state','steak','steal','steam','steel','steep','stick',
    'stiff','still','stock','stone','store','storm','story','stove','strip','study',
    'stuff','style','sugar','suite','sunny','super','sweet','swift','swing','sword',
    'table','taste','teach','thank','theme','there','thick','thing','think',
    'third','those','three','threw','throw','thumb','tiger','tight','timer','tired',
    'title','today','token','tooth','topic','total','touch','tough','tower','track',
    'trade','trail','train','trait','trash','treat','trend','trial','tribe','trick',
    'truck','truly','trunk','trust','truth','tumor','turbo','twice','uncle','under',
    'union','unite','unity','until','upper','upset','urban','usage','usual','valid',
    'value','vapor','vault','venue','verse','video','virus','visit','vital','vivid',
    'vocal','voice','waste','watch','water','weigh','weird','wheel','where','which',
    'while','white','whole','whose','woman','world','worry','worth','would','wound',
    'write','wrong','yield','young','youth'
  ].filter(function (w) { return /^[a-z]{5}$/.test(w); });

  // dedupe while preserving order
  var seen = {}, clean = [];
  for (var i = 0; i < ANSWERS.length; i++) {
    if (!seen[ANSWERS[i]]) { seen[ANSWERS[i]] = true; clean.push(ANSWERS[i]); }
  }

  global.WORDS = { ANSWERS: clean, VALID: clean };
})(window);
