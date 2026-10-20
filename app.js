(function(){
'use strict';
var COLS=['produtos','clientes','pedidos','caixa','config'];
var S={produtos:[],clientes:[],pedidos:[],caixa:[],config:[],tab:'resumo',q:'',cat:'',filtro:'todos',dia:hoje(),de:hoje().slice(0,8)+'01',ate:hoje(),armed:null,ready:{}};
var draft=null, modalSubmit=null, toastT=null;
var FORMAS=['Dinheiro','Pix','Cartão','Fiado'];
var TABS=[['resumo','Resumo'],['pedidos','Pedidos'],['estoque','Estoque'],['clientes','Clientes'],['caixa','Caixa'],['relatorios','Relatórios']];

function $(s){return document.querySelector(s)}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function brl(n){return (Number(n)||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}
function num(v){
  if(typeof v==='number')return v;
  var s=String(v||'').trim().replace(/[^\d.,-]/g,'');
  if(s.indexOf(',')>-1)s=s.replace(/\./g,'').replace(',','.');
  var n=parseFloat(s);return isNaN(n)?0:n;
}
function hoje(){return new Date().toLocaleDateString('sv-SE')}
function dia(iso){return new Date(iso).toLocaleDateString('sv-SE')}
function dh(iso){return new Date(iso).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}
function nid(){return (window.crypto&&crypto.randomUUID)?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0;return (c==='x'?r:(r&3|8)).toString(16)})}
function toast(m){var t=$('#toast');t.textContent=m;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(function(){t.hidden=true},3500)}
function by(col,id){return S[col].find(function(x){return x.id===id})}
function norm(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')}

/* ---------- banco de dados (Supabase) ---------- */
var sb=null, sbCanal=null, refreshT=null, logadoId, fatal='';
var LIM={pedidos:1500,caixa:4000};
function n2(v){return v==null?0:Number(v)}
var FROM={
  produtos:function(r){return {id:r.id,nome:r.nome,categoria:r.categoria||'',preco:n2(r.preco),custo:n2(r.custo),estoque:r.estoque||0,minimo:r.minimo||0}},
  clientes:function(r){return {id:r.id,nome:r.nome,telefone:r.telefone||'',cidade:r.cidade||'',endereco:r.endereco||'',obs:r.obs||''}},
  caixa:function(r){return {id:r.id,tipo:r.tipo,valor:n2(r.valor),descricao:r.descricao||'',forma:r.forma||'',pedidoId:r.pedido_id||'',criado:r.criado}},
  pedidos:function(r){return {id:r.id,numero:r.numero,clienteId:r.cliente_id||'',clienteNome:r.cliente_nome||'',itens:r.itens||[],desconto:n2(r.desconto),subtotal:n2(r.subtotal),total:n2(r.total),forma:r.forma,status:r.status,obs:r.obs||'',
    entrega:{tipo:r.entrega_tipo||'Retirada',endereco:r.entrega_endereco||'',taxa:n2(r.entrega_taxa)},entregue:!!r.entregue,criado:r.criado,pagoEm:r.pago_em}},
  config:function(r){return Object.assign({},r.valor||{},{id:r.chave})}
};
var COLNAME={caixa:{pedidoId:'pedido_id'}};
function toRow(col,d){
  var m=COLNAME[col]||{}, o={};
  Object.keys(d).forEach(function(k){o[m[k]||k]=d[k]});
  if('pedido_id' in o&&!o.pedido_id)o.pedido_id=null;
  return o;
}
function dbErr(e){
  console.error(e);
  var m=(e&&e.message)||'';
  toast(/Estoque insuficiente/.test(m)?m:/JWT|not authenticated|permission|policy|row-level/i.test(m)?'Sem permissão. Saia e entre de novo.':'Não foi possível salvar. Tente de novo.');
}
function run(q){return Promise.resolve(q).then(function(r){if(r&&r.error)throw r.error;agendar();return r})}
function guard(p){return p.catch(function(e){dbErr(e);throw e})}
var store={
  set:function(col,id,d){
    if(col==='config')return run(sb.from('config').upsert({chave:id,valor:d}));
    var row=toRow(col,d);row.id=id;return run(sb.from(col).upsert(row));
  },
  update:function(col,id,d){return run(sb.from(col).update(toRow(col,d)).eq('id',id))},
  del:function(col,id){return run(sb.from(col).delete().eq('id',id))}
};
var api={
  criarPedido:function(p){return run(sb.rpc('criar_pedido',{p:p}))},
  receber:function(id,forma){return run(sb.rpc('receber_pedido',{p_id:id,p_forma:forma}))},
  cancelar:function(id){return run(sb.rpc('cancelar_pedido',{p_id:id}))}
};
function agendar(){clearTimeout(refreshT);refreshT=setTimeout(carregar,200)}
function carregar(){
  if(!sb||!logadoId)return Promise.resolve();
  var q=[sb.from('produtos').select('*'),sb.from('clientes').select('*'),
    sb.from('pedidos').select('*').order('criado',{ascending:false}).limit(LIM.pedidos),
    sb.from('caixa').select('*').order('criado',{ascending:false}).limit(LIM.caixa),
    sb.from('config').select('*')];
  return Promise.all(q).then(function(rs){
    COLS.forEach(function(c,i){if(rs[i].error)throw rs[i].error;S[c]=(rs[i].data||[]).map(FROM[c]);S.ready[c]=true});
    render();
  }).catch(function(e){console.error(e);toast('Não foi possível carregar os dados. Verifique a conexão.')});
}
function ouvir(){
  if(sbCanal)return;
  sbCanal=sb.channel('zeppelin').on('postgres_changes',{event:'*',schema:'public'},agendar).subscribe();
}
function entrar(session){
  var id=session&&session.user?session.user.id:null;
  if(id===logadoId)return;
  logadoId=id;
  $('#login').hidden=!!id;$('#sair').hidden=!id;
  if(id){carregar();ouvir()}
  else{
    COLS.forEach(function(c){S[c]=[];S.ready[c]=false});
    if(sbCanal){sb.removeChannel(sbCanal);sbCanal=null}
    render();
  }
}

/* ---------- cálculos ---------- */
function vendasValidas(){return S.pedidos.filter(function(p){return p.status!=='cancelado'})}
function saldoDia(d){return S.caixa.filter(function(c){return dia(c.criado)===d}).reduce(function(a,c){return a+(c.tipo==='entrada'?c.valor:-c.valor)},0)}
function baixo(p){return (p.estoque||0)<=(p.minimo||0)}
function receber(){return S.pedidos.filter(function(p){return p.status==='pendente'})}
function pill(p){
  if(p.status==='cancelado')return '<span class="pill bad">Cancelado</span>';
  if(p.status==='pendente')return '<span class="pill warn">A receber</span>';
  return '<span class="pill good">Pago · '+esc(p.forma)+'</span>';
}
function itensTxt(p){return (p.itens||[]).map(function(i){return i.qtd+'× '+esc(i.nome)}).join(', ')}

/* ---------- telas ---------- */
function vResumo(){
  var h=hoje(), vs=vendasValidas().filter(function(p){return dia(p.criado)===h});
  var vend=vs.reduce(function(a,p){return a+p.total},0);
  var rec=receber().reduce(function(a,p){return a+p.total},0);
  var bx=S.produtos.filter(baixo);
  var o='<div class="head"><h2>Resumo de hoje</h2><div class="row"><button class="btn primary" data-act="novo-pedido">Novo pedido</button><button class="btn" data-act="novo-produto">Novo produto</button><button class="btn" data-act="loja">Dados da loja</button><button class="btn" data-act="tema">Aparência</button></div></div>';
  o+='<div class="tiles">'+
    '<div class="tile"><span>Vendido hoje ('+vs.length+' pedidos)</span><b>'+brl(vend)+'</b></div>'+
    '<div class="tile"><span>Saldo do caixa hoje</span><b>'+brl(saldoDia(h))+'</b></div>'+
    '<div class="tile"><span>A receber (fiado)</span><b>'+brl(rec)+'</b></div>'+
    '<div class="tile'+(bx.length?' alert':'')+'"><span>Produtos com estoque baixo</span><b>'+bx.length+'</b></div>'+
    '<div class="tile'+(entPend().length?' alert':'')+'"><span>Entregas a fazer</span><b>'+entPend().length+'</b></div></div>';
  o+='<div class="cols"><div class="panel"><h3>Repor estoque</h3>';
  if(!S.produtos.length)o+='<p class="hint">Cadastre os produtos na aba Estoque para ver os alertas aqui.</p>';
  else if(!bx.length)o+='<p class="hint">Nenhum produto abaixo do mínimo.</p>';
  else o+='<div class="list">'+bx.sort(function(a,b){return a.estoque-b.estoque}).slice(0,8).map(function(p){
    return '<div class="li"><div>'+esc(p.nome)+'<small>mínimo '+(p.minimo||0)+'</small></div><span class="pill '+(p.estoque<=0?'bad':'warn')+'">'+(p.estoque<=0?'Sem estoque':p.estoque+' un.')+'</span></div>'}).join('')+'</div>';
  o+='</div><div class="panel"><h3>Últimos pedidos</h3>';
  var ult=S.pedidos.slice().sort(function(a,b){return b.criado<a.criado?-1:1}).slice(0,6);
  if(!ult.length)o+='<p class="hint">Nenhum pedido ainda. Use “Novo pedido” para registrar a primeira venda.</p>';
  else o+='<div class="list">'+ult.map(function(p){return '<div class="li"><div>#'+p.numero+' · '+esc(p.clienteNome||'Balcão')+'<small>'+dh(p.criado)+'</small></div><div style="text-align:right"><b>'+brl(p.total)+'</b><small>'+pill(p)+'</small></div></div>'}).join('')+'</div>';
  return o+'</div></div>';
}

function vPedidos(){
  var q=norm(S.q);
  var l=S.pedidos.slice().sort(function(a,b){return b.criado<a.criado?-1:1}).filter(function(p){
    if(S.filtro==='pendente'&&p.status!=='pendente')return false;
    if(S.filtro==='pago'&&p.status!=='pago')return false;
    if(S.filtro==='cancelado'&&p.status!=='cancelado')return false;
    if(q&&norm('#'+p.numero+' '+(p.clienteNome||'balcao')+' '+itensTxt(p)).indexOf(q)<0)return false;
    return true});
  var o='<div class="head"><h2>Pedidos</h2><button class="btn primary" data-act="novo-pedido">Novo pedido</button></div>';
  o+='<div class="row" style="margin-bottom:14px">'+[['todos','Todos'],['pendente','A receber'],['pago','Pagos'],['cancelado','Cancelados']].map(function(f){
    return '<button class="chip" data-act="filtro" data-id="'+f[0]+'" aria-pressed="'+(S.filtro===f[0])+'">'+f[1]+'</button>'}).join('')+
    '<input id="q" class="search" type="search" placeholder="Buscar cliente, item ou nº" value="'+esc(S.q)+'" aria-label="Buscar pedidos"></div>';
  if(!l.length)return o+'<div class="empty"><b>'+(S.pedidos.length?'Nada encontrado':'Nenhum pedido registrado')+'</b>'+(S.pedidos.length?'Mude o filtro ou a busca.':'Cada pedido baixa o estoque e lança o valor no caixa.')+'</div>';
  return o+l.map(function(p){
    var a='<button class="btn sm" data-act="recibo" data-id="'+p.id+'">Recibo / PDF</button>';
    if(isEntrega(p)&&p.status!=='cancelado'&&!p.entregue)a+='<button class="btn sm" data-act="entregue" data-id="'+p.id+'">Marcar entregue</button>';
    if(p.status==='pendente')a+='<button class="btn sm primary" data-act="receber" data-id="'+p.id+'">Receber</button>';
    if(p.status!=='cancelado')a+='<button class="btn sm danger'+(S.armed==='cancelar'+p.id?' armed':'')+'" data-act="cancelar" data-id="'+p.id+'" data-confirm="1">'+(S.armed==='cancelar'+p.id?'Confirmar cancelamento':'Cancelar pedido')+'</button>';
    return '<article class="ord"><h3>#'+p.numero+' · '+esc(p.clienteNome||'Balcão')+'</h3><div class="tot">'+brl(p.total)+'</div>'+
      '<p>'+itensTxt(p)+(p.desconto?' · desconto '+brl(p.desconto):'')+(isEntrega(p)?'<br>Entrega: '+esc(p.entrega.endereco||'endereço não informado')+(p.entrega.taxa?' · taxa '+brl(p.entrega.taxa):''):'')+(p.obs?'<br>'+esc(p.obs):'')+'</p><div>'+pill(p)+(isEntrega(p)&&p.status!=='cancelado'?(p.entregue?' <span class="pill good">Entregue</span>':' <span class="pill sky">Entrega</span>'):'')+'</div>'+
      '<div class="row"><span class="hint">'+dh(p.criado)+'</span><span class="row">'+a+'</span></div></article>'}).join('');
}

function vEstoque(){
  var q=norm(S.q), cats=getCats();
  var l=S.produtos.slice().sort(function(a,b){return norm(a.nome)<norm(b.nome)?-1:1}).filter(function(p){
    return (!S.cat||p.categoria===S.cat)&&(!q||norm(p.nome+' '+(p.categoria||'')).indexOf(q)>=0)});
  var vc=S.produtos.reduce(function(a,p){return a+(p.custo||0)*Math.max(p.estoque||0,0)},0);
  var vv=S.produtos.reduce(function(a,p){return a+(p.preco||0)*Math.max(p.estoque||0,0)},0);
  var o='<div class="head"><h2>Estoque</h2><div class="row"><button class="btn" data-act="cats">Categorias</button><button class="btn primary" data-act="novo-produto">Novo produto</button></div></div>';
  if(!S.produtos.length){
    return o+'<div class="empty"><b>Nenhum produto cadastrado</b>Cadastre pipas, fogos, linhas e acessórios com preço, custo e estoque mínimo.<div class="row"><button class="btn primary" data-act="novo-produto">Cadastrar produto</button><button class="btn" data-act="exemplos">Carregar produtos de exemplo</button></div></div>';}
  o+='<div class="tiles"><div class="tile"><span>Itens cadastrados</span><b>'+S.produtos.length+'</b></div><div class="tile"><span>Valor em estoque (custo)</span><b>'+brl(vc)+'</b></div><div class="tile"><span>Valor em estoque (venda)</span><b>'+brl(vv)+'</b></div></div>';
  o+='<div class="row" style="margin-bottom:14px"><button class="chip" data-act="cat" data-id="" aria-pressed="'+(!S.cat)+'">Todas</button>'+cats.map(function(c){return '<button class="chip" data-act="cat" data-id="'+esc(c)+'" aria-pressed="'+(S.cat===c)+'">'+esc(c)+'</button>'}).join('')+
    '<input id="q" class="search" type="search" placeholder="Buscar produto" value="'+esc(S.q)+'" aria-label="Buscar produtos"></div>';
  o+='<div class="tbl"><table><thead><tr><th>Produto</th><th>Categoria</th><th class="r">Preço</th><th class="r">Custo</th><th class="r">Estoque</th><th></th></tr></thead><tbody>'+
  l.map(function(p){
    var st=p.estoque<=0?'<span class="pill bad">Sem estoque</span>':baixo(p)?'<span class="pill warn">Baixo · '+p.estoque+'</span>':'<b>'+p.estoque+'</b>';
    return '<tr><td>'+esc(p.nome)+'</td><td>'+esc(p.categoria||'—')+'</td><td class="r">'+brl(p.preco)+'</td><td class="r">'+brl(p.custo)+'</td><td class="r">'+st+'</td><td class="acts">'+
      '<button class="btn sm" data-act="ajuste" data-id="'+p.id+'">Ajustar</button><button class="btn sm" data-act="edit-produto" data-id="'+p.id+'">Editar</button>'+
      '<button class="btn sm danger'+(S.armed==='delp'+p.id?' armed':'')+'" data-act="del-produto" data-id="'+p.id+'" data-confirm="1">'+(S.armed==='delp'+p.id?'Confirmar?':'Excluir')+'</button></td></tr>'}).join('')+'</tbody></table></div>';
  return o;
}

function vClientes(){
  var q=norm(S.q);
  var l=S.clientes.slice().sort(function(a,b){return norm(a.nome)<norm(b.nome)?-1:1}).filter(function(c){return !q||norm(c.nome+' '+(c.telefone||'')+' '+(c.cidade||'')).indexOf(q)>=0});
  var o='<div class="head"><h2>Clientes</h2><button class="btn primary" data-act="novo-cliente">Novo cliente</button></div>';
  if(!S.clientes.length)return o+'<div class="empty"><b>Nenhum cliente cadastrado</b>Cadastre quem compra com você para acompanhar pedidos e fiado.<div class="row"><button class="btn primary" data-act="novo-cliente">Cadastrar cliente</button></div></div>';
  o+='<div class="row" style="margin-bottom:14px"><input id="q" class="search" type="search" placeholder="Buscar nome, telefone ou cidade" value="'+esc(S.q)+'" aria-label="Buscar clientes"></div>';
  return o+'<div class="tbl"><table><thead><tr><th>Cliente</th><th>Telefone</th><th>Cidade / bairro</th><th class="r">Pedidos</th><th class="r">Comprou</th><th class="r">Deve</th><th></th></tr></thead><tbody>'+
  l.map(function(c){
    var ps=vendasValidas().filter(function(p){return p.clienteId===c.id});
    var tot=ps.reduce(function(a,p){return a+p.total},0), dv=ps.filter(function(p){return p.status==='pendente'}).reduce(function(a,p){return a+p.total},0);
    return '<tr><td>'+esc(c.nome)+(c.obs?'<div class="hint">'+esc(c.obs)+'</div>':'')+'</td><td>'+(c.telefone?'<span class="fone">'+esc(c.telefone)+waIcon(c.telefone,c.nome)+'</span>':'—')+'</td><td>'+esc(c.cidade||'—')+(c.endereco?'<div class="hint">'+esc(c.endereco)+'</div>':'')+'</td><td class="r">'+ps.length+'</td><td class="r">'+brl(tot)+'</td><td class="r">'+(dv?'<span class="pill warn">'+brl(dv)+'</span>':'—')+'</td><td class="acts">'+
      '<button class="btn sm" data-act="novo-pedido" data-id="'+c.id+'">Pedido</button><button class="btn sm" data-act="edit-cliente" data-id="'+c.id+'">Editar</button>'+
      '<button class="btn sm danger'+(S.armed==='delc'+c.id?' armed':'')+'" data-act="del-cliente" data-id="'+c.id+'" data-confirm="1">'+(S.armed==='delc'+c.id?'Confirmar?':'Excluir')+'</button></td></tr>'}).join('')+'</tbody></table></div>';
}

function vCaixa(){
  var mv=S.caixa.filter(function(c){return dia(c.criado)===S.dia}).sort(function(a,b){return b.criado<a.criado?-1:1});
  var ent=0,sai=0,pf={};
  mv.forEach(function(c){if(c.tipo==='entrada'){ent+=c.valor;pf[c.forma]=(pf[c.forma]||0)+c.valor}else sai+=c.valor});
  var o='<div class="head"><h2>Caixa</h2><div class="row"><label style="flex-direction:row;align-items:center;gap:8px">Dia<input id="dia" type="date" value="'+esc(S.dia)+'" style="width:auto"></label>'+
    '<button class="btn" data-act="mov" data-id="saida">Registrar saída</button><button class="btn primary" data-act="mov" data-id="entrada">Registrar entrada</button></div></div>';
  o+='<div class="tiles"><div class="tile"><span>Entradas</span><b class="in">'+brl(ent)+'</b></div><div class="tile"><span>Saídas</span><b class="out">'+brl(sai)+'</b></div><div class="tile"><span>Saldo do dia</span><b>'+brl(ent-sai)+'</b></div></div>';
  var fk=Object.keys(pf);
  if(fk.length)o+='<div class="row" style="margin-bottom:14px">'+fk.map(function(k){return '<span class="pill sky">'+esc(k)+' '+brl(pf[k])+'</span>'}).join('')+'</div>';
  if(!mv.length)return o+'<div class="empty"><b>Sem movimentos neste dia</b>Vendas pagas entram aqui sozinhas. Use os botões acima para despesas, troco ou outras entradas.</div>';
  return o+'<div class="tbl"><table><thead><tr><th>Hora</th><th>Descrição</th><th>Forma</th><th class="r">Valor</th></tr></thead><tbody>'+
    mv.map(function(c){return '<tr><td>'+new Date(c.criado).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})+'</td><td>'+esc(c.descricao)+'</td><td>'+esc(c.forma||'—')+'</td><td class="r '+(c.tipo==='entrada'?'in':'out')+'">'+(c.tipo==='entrada'?'+ ':'− ')+brl(c.valor)+'</td></tr>'}).join('')+'</tbody></table></div>';
}

var VIEWS={resumo:vResumo,pedidos:vPedidos,estoque:vEstoque,clientes:vClientes,caixa:vCaixa,relatorios:vRelatorios};
function render(){
  applyTema();brand();
  var a=document.activeElement, id=a&&a.id, ss=null, se=null;
  if(a&&(a.id==='q')){ss=a.selectionStart;se=a.selectionEnd}
  $('#tabs').innerHTML=TABS.map(function(t){return '<button data-act="tab" data-id="'+t[0]+'"'+(S.tab===t[0]?' aria-current="page"':'')+'>'+t[1]+'</button>'}).join('');
  $('#main').innerHTML=fatal||VIEWS[S.tab]();
  if(id){var el=document.getElementById(id);if(el&&el!==a){el.focus();if(ss!=null&&el.setSelectionRange){try{el.setSelectionRange(ss,se)}catch(e){}}}}
}

/* ---------- janelas ---------- */
function openModal(title,body,label,onSubmit,wide){
  $('#mt').textContent=title;$('#mb').innerHTML=body;
  $('#mfoot').innerHTML='<button type="button" class="btn" data-act="close">Cancelar</button><button type="submit" class="btn primary">'+esc(label||'Salvar')+'</button>';
  modalSubmit=onSubmit;$('#modal').hidden=false;
  var f=$('#mb').querySelector('input:not([type=hidden]),select');if(f)f.focus();
}
function closeModal(){$('#modal').hidden=true;modalSubmit=null;draft=null;if(tPrev){tPrev=null;applyTema()}}
$('#mf').addEventListener('submit',function(e){
  e.preventDefault();if(!modalSubmit)return;
  var fn=modalSubmit, fd=new FormData(e.target);
  Promise.resolve().then(function(){return fn(fd)}).then(function(r){if(r!==false)closeModal()}).catch(function(err){if(err&&err.message&&!err.code)toast(err.message)});
});
function fld(name,label,val,type,extra){return '<label>'+label+'<input name="'+name+'" type="'+(type||'text')+'" value="'+esc(val==null?'':val)+'" '+(extra||'')+'></label>'}
function fmt2(n){return n?String(n).replace('.',','):''}

function mProduto(p){
  p=p||{};
  var cats=getCats();
  openModal(p.id?'Editar produto':'Novo produto',
    fld('nome','Nome do produto',p.nome,'text','required')+
    '<label>Categoria<select name="categoria"><option value="">Sem categoria</option>'+cats.map(function(c){return '<option'+(c===p.categoria?' selected':'')+'>'+esc(c)+'</option>'}).join('')+'</select></label>'+
    '<div class="grid2">'+fld('preco','Preço de venda (R$)',fmt2(p.preco),'text','inputmode="decimal" required')+fld('custo','Custo (R$)',fmt2(p.custo),'text','inputmode="decimal"')+'</div>'+
    '<div class="grid2">'+(p.id?'':fld('estoque','Estoque inicial',0,'number','min="0" step="1"'))+fld('minimo','Estoque mínimo (alerta)',p.minimo==null?5:p.minimo,'number','min="0" step="1"')+'</div>',
    'Salvar',function(fd){
      var nome=String(fd.get('nome')).trim();if(!nome)return false;
      var d={nome:nome,categoria:String(fd.get('categoria')).trim(),preco:num(fd.get('preco')),custo:num(fd.get('custo')),minimo:parseInt(fd.get('minimo'))||0};
      if(p.id)return guard(store.update('produtos',p.id,d));
      d.estoque=parseInt(fd.get('estoque'))||0;return guard(store.set('produtos',nid(),d));
    });
}
function mCliente(c){
  c=c||{};
  openModal(c.id?'Editar cliente':'Novo cliente',
    fld('nome','Nome',c.nome,'text','required')+'<div class="grid2">'+fld('telefone','Telefone / WhatsApp',c.telefone,'tel')+fld('cidade','Cidade ou bairro',c.cidade)+'</div>'+fld('endereco','Endereço para entrega',c.endereco)+
    '<label>Observações<textarea name="obs" rows="2">'+esc(c.obs||'')+'</textarea></label>','Salvar',function(fd){
      var nome=String(fd.get('nome')).trim();if(!nome)return false;
      var d={nome:nome,telefone:String(fd.get('telefone')).trim(),cidade:String(fd.get('cidade')).trim(),endereco:String(fd.get('endereco')).trim(),obs:String(fd.get('obs')).trim()};
      return guard(c.id?store.update('clientes',c.id,d):store.set('clientes',nid(),d));
    });
}
function mAjuste(p){
  openModal('Ajustar estoque · '+p.nome,
    '<p class="hint" style="margin:0">Estoque atual: <b>'+p.estoque+'</b></p>'+
    '<label>Tipo de ajuste<select name="tipo"><option value="entrada">Entrada de mercadoria (+)</option><option value="saida">Perda ou saída (−)</option><option value="definir">Definir quantidade (contagem)</option></select></label>'+
    fld('qtd','Quantidade','','number','min="0" step="1" required')+
    '<label class="check"><input type="checkbox" name="despesa" value="1"> Lançar a compra como saída no caixa (custo × quantidade)</label>','Aplicar',function(fd){
      var q=parseInt(fd.get('qtd'));if(isNaN(q)||q<0)return false;
      var t=fd.get('tipo'), novo=t==='entrada'?p.estoque+q:t==='saida'?p.estoque-q:q;
      if(novo<0){toast('O estoque não pode ficar negativo.');return false}
      return guard(store.update('produtos',p.id,{estoque:novo})).then(function(){
        if(t==='entrada'&&fd.get('despesa')&&p.custo>0)return guard(store.set('caixa',nid(),{tipo:'saida',valor:+(p.custo*q).toFixed(2),descricao:'Compra: '+q+'× '+p.nome,forma:'',criado:new Date().toISOString()}));
      });
    });
}
function mMov(tipo){
  openModal(tipo==='entrada'?'Registrar entrada':'Registrar saída',
    fld('valor','Valor (R$)','','text','inputmode="decimal" required')+fld('descricao','Descrição',tipo==='entrada'?'Troco, aporte…':'Despesa, sangria, frete…','text','required')+
    '<label>Forma<select name="forma">'+FORMAS.filter(function(f){return f!=='Fiado'}).map(function(f){return '<option>'+f+'</option>'}).join('')+'</select></label>','Registrar',function(fd){
      var v=num(fd.get('valor'));if(v<=0)return false;
      return guard(store.set('caixa',nid(),{tipo:tipo,valor:v,descricao:String(fd.get('descricao')).trim(),forma:fd.get('forma'),criado:new Date().toISOString()}));
    });
}
function mReceber(p){
  openModal('Receber pedido #'+p.numero,'<p style="margin:0">Cliente: <b>'+esc(p.clienteNome||'Balcão')+'</b><br>Valor: <b>'+brl(p.total)+'</b></p>'+
    '<label>Forma de pagamento<select name="forma">'+FORMAS.filter(function(f){return f!=='Fiado'}).map(function(f){return '<option>'+f+'</option>'}).join('')+'</select></label>','Confirmar recebimento',function(fd){
      return guard(api.receber(p.id,fd.get('forma')));
    });
}

/* pedido */
function totalDraft(){var s=draft.itens.reduce(function(a,i){return a+i.qtd*i.preco},0);var tx=draft.tipo==='Entrega'?(draft.taxa||0):0;return {sub:s,tot:Math.max(s-(draft.desconto||0),0)+tx}}
function drawItens(){
  var h=draft.itens.length?draft.itens.map(function(i,ix){return '<div class="li"><div>'+i.qtd+'× '+esc(i.nome)+'<small>'+brl(i.preco)+' cada</small></div><div class="row"><b>'+brl(i.qtd*i.preco)+'</b><button type="button" class="btn sm" data-act="rm-item" data-id="'+ix+'" aria-label="Remover '+esc(i.nome)+'">Remover</button></div></div>'}).join(''):'<p class="hint">Nenhum item. Escolha um produto abaixo.</p>';
  $('#itens').innerHTML=h;var t=totalDraft();$('#tot').textContent=brl(t.tot);
}
function mPedido(clienteId){
  if(!S.produtos.length){toast('Cadastre produtos no Estoque antes de lançar pedidos.');return}
  draft={itens:[],desconto:0,taxa:0,tipo:'Retirada'};
  var ps=S.produtos.filter(function(p){return p.estoque>0}).sort(function(a,b){return norm(a.nome)<norm(b.nome)?-1:1});
  openModal('Novo pedido',
    '<label>Cliente<select name="cliente"><option value="">Balcão (sem cadastro)</option>'+S.clientes.slice().sort(function(a,b){return norm(a.nome)<norm(b.nome)?-1:1}).map(function(c){return '<option value="'+c.id+'"'+(c.id===clienteId?' selected':'')+'>'+esc(c.nome)+'</option>'}).join('')+'</select></label>'+
    '<div class="items" id="itens"></div>'+
    '<div class="adder"><label>Produto<select id="ip">'+(ps.length?ps.map(function(p){return '<option value="'+p.id+'">'+esc(p.nome)+' · '+brl(p.preco)+' · '+p.estoque+' un.</option>'}).join(''):'<option value="">Sem produtos em estoque</option>')+'</select></label>'+
    '<label>Qtd<input id="iq" type="number" min="1" step="1" value="1"></label><button type="button" class="btn" data-act="add-item">Adicionar</button></div>'+
    '<div class="grid2">'+fld('desconto','Desconto (R$)','','text','inputmode="decimal" id="desc"')+'<label>Pagamento<select name="forma">'+FORMAS.map(function(f){return '<option>'+f+'</option>'}).join('')+'</select></label></div>'+
    '<label>Retirada ou entrega<select name="tipo" id="tipo"><option>Retirada</option><option>Entrega</option></select></label>'+
    '<div id="entbox" class="fields" hidden>'+fld('endereco','Endereço de entrega','','text','id="end"')+fld('taxa','Taxa de entrega (R$)','','text','inputmode="decimal" id="taxa"')+'</div>'+
    '<label>Observações<input name="obs" type="text"></label>'+
    '<div class="sum"><span>Total</span><span id="tot">R$ 0,00</span></div>',
    'Salvar pedido',function(fd){
      if(!draft.itens.length){toast('Adicione ao menos um item.');return false}
      var cli=by('clientes',fd.get('cliente')), forma=fd.get('forma');
      var ped={cliente_id:cli?cli.id:null,cliente_nome:cli?cli.nome:'',itens:draft.itens.map(function(i){return {pid:i.pid,qtd:i.qtd}}),desconto:draft.desconto||0,
        entrega_tipo:draft.tipo,entrega_endereco:String(fd.get('endereco')||'').trim(),entrega_taxa:draft.tipo==='Entrega'?(draft.taxa||0):0,forma:forma,obs:String(fd.get('obs')).trim()};
      return guard(api.criarPedido(ped)).then(function(r){toast('Pedido #'+(r.data&&r.data.numero)+' salvo.')});
    });
  drawItens();
}

/* ---------- recibo, PDF e relatórios ---------- */
function loja(){return by('config','loja')||{}}
function isEntrega(p){return !!(p&&p.entrega&&p.entrega.tipo==='Entrega')}
function entPend(){return vendasValidas().filter(function(p){return isEntrega(p)&&!p.entregue})}
function plain(n){return brl(n).replace(/ /g,' ')}
function digits(s){return String(s||'').replace(/\D/g,'')}
function waNum(tel){
  var d=digits(tel), dd=digits(loja().ddd).slice(0,2);
  if(d.length>=8&&d.length<=9&&dd.length===2)d=dd+d;
  if(d.length<10)return '';
  if(d.length<=11)d='55'+d;
  return d;
}
function waIcon(tel,nome){
  var n=waNum(tel);if(!n)return '';
  return '<a class="wa" target="_blank" rel="noopener" href="https://wa.me/'+n+'" title="Abrir conversa no WhatsApp" aria-label="Abrir conversa no WhatsApp com '+esc(nome||'o cliente')+'">'+
    '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#25D366"/><path d="M12 5.2a6.8 6.8 0 0 0-5.8 10.3L5.2 18.8l3.4-1a6.8 6.8 0 1 0 3.4-12.6z" fill="none" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/><path d="M9.6 9.1c.2-.3.5-.3.7 0l.6 1.2c.1.2 0 .4-.1.6l-.4.5c.5 1 1.3 1.8 2.3 2.3l.5-.4c.2-.2.4-.2.6-.1l1.2.6c.3.2.3.5 0 .8-.6.8-1.5.9-2.4.5a6.8 6.8 0 0 1-3.3-3.2c-.4-.9-.3-1.8.3-2.8z" fill="#fff"/></svg></a>';
}
function slug(s){return norm(s).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'cliente'}
function fmtn(n){return (Number(n)||0).toFixed(2).replace('.',',')}
function daysAgo(n){var d=new Date();d.setDate(d.getDate()-n);return d.toLocaleDateString('sv-SE')}
function reciboTexto(p){
  var l=loja(), L=['*'+(l.nome||'Zeppelin')+'*'];
  if(l.telefone)L.push(l.telefone);
  L.push('','Pedido #'+p.numero+' - '+dh(p.criado),'Cliente: '+(p.clienteNome||'Balcão'),'');
  (p.itens||[]).forEach(function(i){L.push(i.qtd+'x '+i.nome+' - '+plain(i.qtd*i.preco))});
  L.push('');
  if(p.desconto)L.push('Desconto: -'+plain(p.desconto));
  if(isEntrega(p)){if(p.entrega.taxa)L.push('Taxa de entrega: '+plain(p.entrega.taxa));L.push('Entrega: '+(p.entrega.endereco||'a combinar'))}
  L.push('*Total: '+plain(p.total)+'*');
  L.push(p.status==='pago'?'Pago ('+p.forma+')':p.status==='pendente'?'A pagar (fiado)':'PEDIDO CANCELADO');
  if(l.pix&&p.status==='pendente')L.push('Pix: '+l.pix);
  L.push('',l.rodape||'Obrigado pela preferência!');
  return L.join('\n');
}
function mRecibo(p){
  if(!p)return;
  var cli=by('clientes',p.clienteId), tel=waNum(cli&&cli.telefone), txt=reciboTexto(p);
  openModal('Recibo do pedido #'+p.numero,'<div class="receipt">'+esc(txt)+'</div><p class="hint" style="margin:0">Para enviar o PDF, use Enviar PDF (no celular) ou baixe o arquivo e anexe na conversa com o cliente. O botão WhatsApp abre a conversa já com este texto.</p>','',null);
  $('#mfoot').innerHTML='<button type="button" class="btn" data-act="close">Fechar</button><button type="button" class="btn" data-act="copiar" data-id="'+p.id+'">Copiar texto</button>'+
    '<a class="btn" target="_blank" rel="noopener" href="https://wa.me/'+tel+'?text='+encodeURIComponent(txt)+'">WhatsApp</a>'+(navigator.canShare?'<button type="button" class="btn" data-act="pdf-share" data-id="'+p.id+'">Enviar PDF</button>':'')+'<button type="button" class="btn primary" data-act="pdf" data-id="'+p.id+'">Baixar PDF</button>';
}
function copiar(t){
  var ok=function(){toast('Texto copiado.')}, no=function(){toast('Não foi possível copiar. Selecione o texto do recibo e copie.')};
  try{navigator.clipboard.writeText(t).then(ok,no)}catch(e){no()}
}
function salvarArq(nome,data,compartilhar){
  var b=data instanceof Blob?data:new Blob([data],{type:/\.pdf$/i.test(nome)?'application/pdf':'text/csv;charset=utf-8'});
  if(compartilhar&&navigator.canShare){
    var f=new File([b],nome,{type:b.type});
    if(navigator.canShare({files:[f]})){
      navigator.share({files:[f],title:nome}).catch(function(e){if(e&&e.name!=='AbortError')toast('Não foi possível compartilhar. Use Baixar PDF.')});
      return;
    }
  }
  var u=URL.createObjectURL(b), a=document.createElement('a');
  a.href=u;a.download=nome;document.body.appendChild(a);a.click();a.remove();
  setTimeout(function(){URL.revokeObjectURL(u)},4000);toast('Arquivo salvo.');
}
function novoPdf(){
  if(!window.jspdf){toast('Não foi possível carregar o gerador de PDF. Verifique a internet e recarregue.');return null}
  return new window.jspdf.jsPDF({unit:'mm',format:'a4'});
}
function pdfCab(doc,dir1,dir2){
  var l=loja(), W=210, M=16;
  var ac=tema().acento||'#d92d20';if(!/^#[0-9a-f]{6}$/i.test(ac))ac='#d92d20';
  doc.setFillColor(parseInt(ac.substr(1,2),16),parseInt(ac.substr(3,2),16),parseInt(ac.substr(5,2),16));doc.rect(0,0,W,30,'F');
  var x0=M;
  if(l.logo){
    try{
      var pr=doc.getImageProperties(l.logo), box=20, k=Math.min(box/pr.width,box/pr.height), w=pr.width*k, h=pr.height*k;
      doc.setFillColor(255,255,255);doc.roundedRect(M,4,box+4,box+4,3,3,'F');
      doc.addImage(l.logo,/^data:image\/png/.test(l.logo)?'PNG':'JPEG',M+2+(box-w)/2,6+(box-h)/2,w,h);
      x0=M+30;
    }catch(e){x0=M}
  }
  doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(22);doc.text(l.nome||'Zeppelin',x0,16);
  doc.setFont('helvetica','normal');doc.setFontSize(10);
  doc.text([l.telefone,l.endereco].filter(Boolean).join('  |  ')||'Pipas, fogos e afins',x0,23);
  doc.setFont('helvetica','bold');doc.setFontSize(12);doc.text(dir1,W-M,16,{align:'right'});
  doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text(dir2,W-M,23,{align:'right'});
  doc.setTextColor(16,32,58);
}
function pdfPedido(p,compartilhar){
  if(!p)return;
  var doc=novoPdf();if(!doc)return;
  var l=loja(), W=210, M=16, y=42, cli=by('clientes',p.clienteId);
  pdfCab(doc,'PEDIDO #'+p.numero,dh(p.criado));
  doc.setFont('helvetica','bold');doc.setFontSize(11);doc.text('Cliente',M,y);
  doc.setFont('helvetica','normal');doc.text(p.clienteNome||'Balcão',M,y+6);
  if(cli&&cli.telefone)doc.text(cli.telefone,M,y+12);
  doc.setFont('helvetica','bold');doc.text(isEntrega(p)?'Entrega':'Retirada na loja',W/2,y);
  if(isEntrega(p)){doc.setFont('helvetica','normal');doc.text(doc.splitTextToSize(p.entrega.endereco||'Endereço a combinar',W/2-M),W/2,y+6)}
  y+=26;
  doc.setFillColor(238,242,248);doc.rect(M,y-5,W-2*M,8,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(10);
  doc.text('Qtd',M+2,y);doc.text('Produto',M+18,y);doc.text('Unitário',W-M-34,y,{align:'right'});doc.text('Subtotal',W-M-2,y,{align:'right'});
  y+=8;doc.setFont('helvetica','normal');
  (p.itens||[]).forEach(function(i){
    if(y>262){doc.addPage();y=20}
    var nm=doc.splitTextToSize(i.nome,95);
    doc.text(String(i.qtd),M+2,y);doc.text(nm,M+18,y);doc.text(plain(i.preco),W-M-34,y,{align:'right'});doc.text(plain(i.qtd*i.preco),W-M-2,y,{align:'right'});
    y+=5*nm.length+2;doc.setDrawColor(216,224,235);doc.line(M,y-3,W-M,y-3);
  });
  y+=4;if(y>225){doc.addPage();y=20}
  function lin(a,b,forte){doc.setFont('helvetica',forte?'bold':'normal');doc.setFontSize(forte?13:10);doc.text(a,W-M-62,y);doc.text(b,W-M-2,y,{align:'right'});y+=forte?9:6}
  var sub=(p.itens||[]).reduce(function(a,i){return a+i.qtd*i.preco},0);
  lin('Subtotal',plain(sub));
  if(p.desconto)lin('Desconto','-'+plain(p.desconto));
  if(isEntrega(p)&&p.entrega.taxa)lin('Taxa de entrega',plain(p.entrega.taxa));
  lin('TOTAL',plain(p.total),true);
  y+=2;doc.setFontSize(11);doc.setFont('helvetica','bold');
  doc.text(p.status==='pago'?'PAGO - '+p.forma:p.status==='pendente'?'A PAGAR (fiado)':'PEDIDO CANCELADO',M,y);
  if(p.status==='pendente'&&l.pix){doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text('Chave Pix: '+l.pix,M,y+6);y+=6}
  if(p.obs){y+=9;doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text(doc.splitTextToSize('Obs.: '+p.obs,W-2*M),M,y)}
  doc.setTextColor(90,107,130);doc.setFontSize(9);doc.text(l.rodape||'Obrigado pela preferência!',W/2,285,{align:'center'});
  salvarArq('Pedido-'+p.numero+'-'+slug(p.clienteNome||'balcao')+'.pdf',doc.output('blob'),compartilhar);
}
var logoDraft='', brandSvg=null;
function lerLogo(file){
  return new Promise(function(res,rej){
    var fr=new FileReader();fr.onerror=rej;
    fr.onload=function(){
      var im=new Image();im.onerror=rej;
      im.onload=function(){
        var k=Math.min(1,300/Math.max(im.width,im.height,1)), c=document.createElement('canvas');
        c.width=Math.max(1,Math.round(im.width*k));c.height=Math.max(1,Math.round(im.height*k));
        var cx=c.getContext('2d');cx.drawImage(im,0,0,c.width,c.height);
        var u=c.toDataURL('image/png');
        if(u.length>180000){cx.globalCompositeOperation='destination-over';cx.fillStyle='#fff';cx.fillRect(0,0,c.width,c.height);u=c.toDataURL('image/jpeg',0.85)}
        res(u);
      };
      im.src=fr.result;
    };
    fr.readAsDataURL(file);
  });
}
function logoPrev(){
  var h=$('#logoPrev');if(!h)return;
  h.innerHTML=logoDraft?'<img src="'+logoDraft+'" alt="Logo da loja" style="max-height:64px;max-width:100%;background:#fff;border:1px solid var(--line);border-radius:8px;padding:4px"><button type="button" class="btn sm" data-act="rm-logo">Remover logo</button>':'<span class="hint">Nenhum logo enviado.</span>';
}
function brand(){
  var br=document.querySelector('.brand'), l=loja();if(!br)return;
  if(!brandSvg)brandSvg=br.querySelector('svg');
  var im=br.querySelector('img');
  if(l.logo){
    if(!im){im=document.createElement('img');im.alt='';im.style.cssText='height:32px;width:auto;border-radius:6px';br.insertBefore(im,br.firstChild)}
    if(im.getAttribute('src')!==l.logo)im.src=l.logo;
    if(brandSvg)brandSvg.style.display='none';
  }else{if(im)im.remove();if(brandSvg)brandSvg.style.display=''}
}
function mLoja(){
  var l=loja();logoDraft=l.logo||'';
  openModal('Dados da loja',
    '<p class="hint" style="margin:0">Aparecem no topo do recibo e do PDF dos pedidos.</p>'+
    fld('nome','Nome da loja',l.nome||'Zeppelin')+
    '<label>Logo da loja (imagem PNG, JPG ou SVG)<input type="file" id="logoFile" accept="image/*"></label><div id="logoPrev" class="row"></div>'+
    '<div class="grid2">'+fld('telefone','Telefone / WhatsApp',l.telefone,'tel')+fld('pix','Chave Pix',l.pix)+'</div>'+
    fld('ddd','DDD padrão (usado em telefones de clientes sem DDD)',l.ddd,'text','inputmode="numeric" maxlength="2"')+
    fld('endereco','Endereço da loja',l.endereco)+fld('rodape','Mensagem no rodapé',l.rodape||'Obrigado pela preferência!'),'Salvar',function(fd){
      return guard(store.set('config','loja',{nome:String(fd.get('nome')).trim(),logo:logoDraft,telefone:String(fd.get('telefone')).trim(),pix:String(fd.get('pix')).trim(),ddd:digits(fd.get('ddd')).slice(0,2),endereco:String(fd.get('endereco')).trim(),rodape:String(fd.get('rodape')).trim()}));
    });
  logoPrev();
}
function resumoPeriodo(){
  var ps=vendasValidas().filter(function(p){var d=dia(p.criado);return d>=S.de&&d<=S.ate}), r={ps:ps,fat:0,custo:0,forma:{},dias:{},aberto:0}, prod={};
  ps.forEach(function(p){
    r.fat+=p.total;r.forma[p.forma]=(r.forma[p.forma]||0)+p.total;
    var d=dia(p.criado);r.dias[d]=r.dias[d]||{n:0,v:0};r.dias[d].n++;r.dias[d].v+=p.total;
    if(p.status==='pendente')r.aberto+=p.total;
    (p.itens||[]).forEach(function(i){r.custo+=(i.custo||0)*i.qtd;prod[i.nome]=prod[i.nome]||{q:0,v:0};prod[i.nome].q+=i.qtd;prod[i.nome].v+=i.qtd*i.preco});
  });
  r.tp=Object.keys(prod).map(function(k){return {nome:k,q:prod[k].q,v:prod[k].v}}).sort(function(a,b){return b.v-a.v});
  r.lucro=r.fat-r.custo;r.ticket=ps.length?r.fat/ps.length:0;return r;
}
function vRelatorios(){
  var r=resumoPeriodo();
  var o='<div class="head"><h2>Relatório de vendas</h2><div class="row"><button class="btn" data-act="csv">Baixar planilha (CSV)</button><button class="btn primary" data-act="pdf-rel">Baixar PDF</button></div></div>';
  o+='<div class="row" style="margin-bottom:14px"><button class="chip" data-act="per" data-id="hoje">Hoje</button><button class="chip" data-act="per" data-id="7">Últimos 7 dias</button><button class="chip" data-act="per" data-id="mes">Este mês</button>'+
    '<label style="flex-direction:row;align-items:center;gap:8px">De<input id="de" type="date" value="'+esc(S.de)+'" style="width:auto"></label><label style="flex-direction:row;align-items:center;gap:8px">Até<input id="ate" type="date" value="'+esc(S.ate)+'" style="width:auto"></label></div>';
  if(!r.ps.length)return o+'<div class="empty"><b>Nenhuma venda neste período</b>Escolha outras datas ou registre pedidos na aba Pedidos.</div>';
  o+='<div class="tiles"><div class="tile"><span>Faturamento</span><b>'+brl(r.fat)+'</b></div><div class="tile"><span>Pedidos</span><b>'+r.ps.length+'</b></div><div class="tile"><span>Ticket médio</span><b>'+brl(r.ticket)+'</b></div>'+
    '<div class="tile"><span>Lucro estimado (venda − custo)</span><b class="in">'+brl(r.lucro)+'</b></div>'+(r.aberto?'<div class="tile alert"><span>Ainda a receber (fiado)</span><b>'+brl(r.aberto)+'</b></div>':'')+'</div>';
  o+='<div class="cols"><div class="panel"><h3>Mais vendidos</h3><div class="list">'+r.tp.slice(0,10).map(function(x){return '<div class="li"><div>'+esc(x.nome)+'<small>'+x.q+' un.</small></div><b>'+brl(x.v)+'</b></div>'}).join('')+'</div></div>'+
    '<div class="panel"><h3>Por forma de pagamento</h3><div class="list">'+Object.keys(r.forma).map(function(k){return '<div class="li"><span>'+(k==='Fiado'?'Fiado (a receber)':esc(k))+'</span><b>'+brl(r.forma[k])+'</b></div>'}).join('')+'</div>'+
    '<h3 style="margin-top:16px">Por dia</h3><div class="list">'+Object.keys(r.dias).sort().reverse().map(function(d){return '<div class="li"><div>'+d.split('-').reverse().join('/')+'<small>'+r.dias[d].n+' pedidos</small></div><b>'+brl(r.dias[d].v)+'</b></div>'}).join('')+'</div></div></div>';
  return o+'<p class="hint">O lucro estimado só considera itens vendidos depois que o custo foi cadastrado no produto.</p>';
}
function csvPeriodo(){
  var r=resumoPeriodo(), q=function(s){return '"'+String(s==null?'':s).replace(/"/g,'""')+'"'};
  var rows=[['Pedido','Data','Cliente','Itens','Tipo','Endereço','Desconto','Taxa de entrega','Total','Pagamento','Situação'].map(q).join(';')];
  r.ps.slice().sort(function(a,b){return a.criado<b.criado?-1:1}).forEach(function(p){
    rows.push([p.numero,new Date(p.criado).toLocaleString('pt-BR'),p.clienteNome||'Balcão',(p.itens||[]).map(function(i){return i.qtd+'x '+i.nome}).join(' + '),isEntrega(p)?'Entrega':'Retirada',isEntrega(p)?p.entrega.endereco:'',fmtn(p.desconto),fmtn(isEntrega(p)?p.entrega.taxa:0),fmtn(p.total),p.forma,p.status==='pago'?'Pago':'A receber'].map(q).join(';'));
  });
  return '﻿'+rows.join('\r\n');
}
function pdfRel(){
  var r=resumoPeriodo();if(!r.ps.length){toast('Não há vendas neste período.');return}
  var doc=novoPdf();if(!doc)return;
  var W=210, M=16, y=44, f=function(d){return d.split('-').reverse().join('/')};
  pdfCab(doc,'RELATÓRIO DE VENDAS',f(S.de)+' a '+f(S.ate));
  function lin(a,b,forte){if(y>272){doc.addPage();y=20}doc.setFont('helvetica',forte?'bold':'normal');doc.setFontSize(forte?12:10);doc.text(a,M,y);doc.text(b,W-M,y,{align:'right'});y+=forte?8:6}
  lin('Faturamento',plain(r.fat),true);lin('Pedidos',String(r.ps.length));lin('Ticket médio',plain(r.ticket));lin('Lucro estimado',plain(r.lucro));if(r.aberto)lin('A receber (fiado)',plain(r.aberto));
  y+=6;lin('Mais vendidos','',true);
  r.tp.slice(0,15).forEach(function(x){lin(x.nome+'  ('+x.q+' un.)',plain(x.v))});
  y+=6;lin('Por forma de pagamento','',true);
  Object.keys(r.forma).forEach(function(k){lin(k==='Fiado'?'Fiado (a receber)':k,plain(r.forma[k]))});
  y+=6;lin('Por dia','',true);
  Object.keys(r.dias).sort().forEach(function(d){lin(f(d)+'  ('+r.dias[d].n+' pedidos)',plain(r.dias[d].v))});
  salvarArq('Vendas-'+S.de+'-a-'+S.ate+'.pdf',doc.output('blob'));
}

/* ---------- categorias e aparência ---------- */
var catsDraft=[], catsRemoved=[], tPrev=null, temaCache=null;
try{temaCache=JSON.parse(localStorage.getItem('zep-tema')||'null')}catch(e){}
var CORES=[['#d92d20','Vermelho'],['#e8710a','Laranja'],['#12794a','Verde'],['#1d63d8','Azul'],['#7a3fd1','Roxo'],['#d6246e','Rosa'],['#1f2328','Preto']];
function getCats(){
  var c=by('config','categorias'), l=c&&Array.isArray(c.lista)?c.lista.slice():['Pipas','Fogos','Linhas e carretéis','Acessórios'];
  S.produtos.forEach(function(p){if(p.categoria&&l.indexOf(p.categoria)<0)l.push(p.categoria)});
  return l;
}
function drawCats(){
  $('#catlist').innerHTML=catsDraft.map(function(c,i){
    var n=c.orig?S.produtos.filter(function(p){return p.categoria===c.orig}).length:0;
    return '<div class="row" style="flex-wrap:nowrap"><input data-ci="'+i+'" value="'+esc(c.nome)+'" placeholder="Nome da categoria" aria-label="Nome da categoria"><span class="hint" style="white-space:nowrap">'+(c.orig?n+(n===1?' produto':' produtos'):'nova')+'</span><button type="button" class="btn sm danger" data-act="cat-rm" data-id="'+i+'">Remover</button></div>';
  }).join('')||'<p class="hint">Nenhuma categoria. Use o botão abaixo para criar a primeira.</p>';
}
function mCats(){
  catsDraft=getCats().map(function(c){return {orig:c,nome:c}});catsRemoved=[];
  openModal('Categorias','<p class="hint" style="margin:0">Renomear muda a categoria de todos os produtos que a usam. Remover deixa esses produtos sem categoria.</p><div id="catlist" class="fields"></div><div><button type="button" class="btn" data-act="cat-add">Adicionar categoria</button></div>','Salvar',function(){
    var map={}, lista=[];
    catsRemoved.forEach(function(o){map[o]=''});
    catsDraft.forEach(function(c){
      var n=c.nome.trim();
      if(c.orig)map[c.orig]=n;
      if(n&&lista.indexOf(n)<0)lista.push(n);
    });
    var chain=Promise.resolve();
    S.produtos.forEach(function(p){
      if(p.categoria&&Object.prototype.hasOwnProperty.call(map,p.categoria)&&map[p.categoria]!==p.categoria){
        chain=chain.then(function(){return guard(store.update('produtos',p.id,{categoria:map[p.categoria]}))});
      }
    });
    return chain.then(function(){return guard(store.set('config','categorias',{lista:lista}))});
  });
  drawCats();
}
function tema(){return by('config','tema')||temaCache||{}}
function lum(h){var n=parseInt(h.slice(1),16);return (0.299*((n>>16)&255)+0.587*((n>>8)&255)+0.114*(n&255))/255}
function applyTema(){
  var s=by('config','tema');
  if(s&&JSON.stringify(s)!==JSON.stringify(temaCache)){temaCache=s;try{localStorage.setItem('zep-tema',JSON.stringify(s))}catch(e){}}
  var t=tPrev||tema(), r=document.documentElement, m=t.modo||'claro';
  if(m==='auto')r.removeAttribute('data-theme');else r.setAttribute('data-theme',m==='escuro'?'dark':'light');
  if(/^#[0-9a-f]{6}$/i.test(t.acento||'')){r.style.setProperty('--accent',t.acento);r.style.setProperty('--on-accent',lum(t.acento)>0.6?'#1a1a1a':'#ffffff')}
  else{r.style.removeProperty('--accent');r.style.removeProperty('--on-accent')}
}
function drawCores(){
  var cur=(tPrev.acento||CORES[0][0]).toLowerCase();
  $('#cores').innerHTML=CORES.map(function(c){
    return '<button type="button" class="chip" data-act="cor" data-id="'+c[0]+'" aria-pressed="'+(cur===c[0])+'" style="display:inline-flex;align-items:center;gap:6px"><span style="width:14px;height:14px;border-radius:50%;background:'+c[0]+';display:inline-block;border:1px solid var(--line)"></span>'+c[1]+'</button>';
  }).join('');
}
function mTema(){
  var t=tema();tPrev={acento:t.acento||'',modo:t.modo||'claro'};
  openModal('Aparência',
    '<label>Fundo<select id="modo"><option value="claro">Claro: branco e cinza claro</option><option value="escuro">Escuro</option><option value="auto">Automático (segue o aparelho)</option></select></label>'+
    '<div><div class="hint" style="font-weight:700;margin-bottom:6px">Cor dos botões</div><div class="row" id="cores"></div></div>'+
    '<label>Outra cor<input type="color" id="corCustom" value="'+(tPrev.acento||CORES[0][0])+'" style="height:42px;padding:3px"></label>'+
    '<p class="hint" style="margin:0">A mudança vale para todos que usam o sistema e aparece também no PDF.</p>',
    'Salvar',function(){
      var o={acento:tPrev.acento,modo:tPrev.modo};
      return guard(store.set('config','tema',o)).then(function(){
        S.config=S.config.filter(function(x){return x.id!=='tema'}).concat([Object.assign({id:'tema'},o)]);
        tPrev=null;applyTema();
      });
    });
  $('#modo').value=tPrev.modo;drawCores();
}

/* ---------- ações ---------- */
function exemplos(){
  var l=[['Pipa arraia 60 cm','Pipas',3.5,1.2,40],['Pipa raia colorida','Pipas',5,1.8,30],['Pipa quadrada grande','Pipas',8,3,15],['Carretel de linha 500 m','Linhas e carretéis',18,9,20],['Rojão 12 tiros','Fogos',22,12,25],['Vulcão (caixa)','Fogos',15,8,18],['Estrelinha (pacote)','Fogos',6,2.5,3],['Rabiola de papel (pacote)','Acessórios',4,1.5,50]];
  var c=Promise.resolve();
  l.forEach(function(x){c=c.then(function(){return guard(store.set('produtos',nid(),{nome:x[0],categoria:x[1],preco:x[2],custo:x[3],estoque:x[4],minimo:5}))})});
  c.then(function(){toast('Produtos de exemplo carregados. Edite ou exclua à vontade.')});
}
var ACT={
  tab:function(id){S.tab=id;S.q='';S.cat='';S.filtro='todos';try{history.replaceState(null,'','#'+id)}catch(e){}window.scrollTo(0,0);render()},
  close:closeModal,
  filtro:function(id){S.filtro=id;render()},
  cat:function(id){S.cat=id;render()},
  'novo-pedido':function(id){mPedido(id)},
  'novo-produto':function(){mProduto()},
  'edit-produto':function(id){mProduto(by('produtos',id))},
  'del-produto':function(id){guard(store.del('produtos',id))},
  ajuste:function(id){mAjuste(by('produtos',id))},
  exemplos:exemplos,
  'novo-cliente':function(){mCliente()},
  'edit-cliente':function(id){mCliente(by('clientes',id))},
  'del-cliente':function(id){guard(store.del('clientes',id))},
  mov:function(id){mMov(id)},
  receber:function(id){mReceber(by('pedidos',id))},
  cancelar:function(id){
    var p=by('pedidos',id);if(!p||p.status==='cancelado')return;
    guard(api.cancelar(id)).then(function(){toast('Pedido #'+p.numero+' cancelado e estoque devolvido.')});
  },
  'add-item':function(){
    var pid=$('#ip').value, q=parseInt($('#iq').value), p=by('produtos',pid);
    if(!p||!q||q<1)return;
    var ja=draft.itens.find(function(i){return i.pid===pid}), jaQ=ja?ja.qtd:0;
    if(jaQ+q>p.estoque){toast('Estoque insuficiente: restam '+(p.estoque-jaQ)+' un. de '+p.nome+'.');return}
    if(ja)ja.qtd+=q;else draft.itens.push({pid:pid,nome:p.nome,qtd:q,preco:p.preco,custo:p.custo||0});
    $('#iq').value=1;drawItens();
  },
  'rm-item':function(id){draft.itens.splice(parseInt(id),1);drawItens()},
  recibo:function(id){mRecibo(by('pedidos',id))},
  pdf:function(id){pdfPedido(by('pedidos',id))},
  'pdf-share':function(id){pdfPedido(by('pedidos',id),true)},
  sair:function(){if(sb)sb.auth.signOut()},
  copiar:function(id){var p=by('pedidos',id);if(p)copiar(reciboTexto(p))},
  entregue:function(id){guard(store.update('pedidos',id,{entregue:true}))},
  loja:function(){mLoja()},
  'rm-logo':function(){logoDraft='';var f=$('#logoFile');if(f)f.value='';logoPrev()},
  cats:function(){mCats()},
  'cat-add':function(){catsDraft.push({orig:null,nome:''});drawCats();var l=document.querySelectorAll('#catlist input');if(l.length)l[l.length-1].focus()},
  'cat-rm':function(id){var c=catsDraft.splice(parseInt(id),1)[0];if(c&&c.orig)catsRemoved.push(c.orig);drawCats()},
  tema:function(){mTema()},
  cor:function(id){if(!tPrev)return;tPrev.acento=id;var c=$('#corCustom');if(c)c.value=id;applyTema();drawCores()},
  per:function(id){S.ate=hoje();S.de=id==='hoje'?hoje():id==='7'?daysAgo(6):hoje().slice(0,8)+'01';render()},
  csv:function(){salvarArq('Vendas-'+S.de+'-a-'+S.ate+'.csv',csvPeriodo())},
  'pdf-rel':pdfRel
};
document.addEventListener('click',function(e){
  var el=e.target.closest('[data-act]');
  if(!el){if(S.armed){S.armed=null;render()}return}
  var act=el.dataset.act, id=el.dataset.id;
  if(el.dataset.confirm){
    var key={'cancelar':'cancelar','del-produto':'delp','del-cliente':'delc'}[act]+id;
    if(S.armed!==key){S.armed=key;render();setTimeout(function(){if(S.armed===key){S.armed=null;render()}},4000);return}
    S.armed=null;
  }else if(S.armed){S.armed=null}
  if(ACT[act])ACT[act](id);
});
document.addEventListener('input',function(e){
  var t=e.target;
  if(t.id==='q'){S.q=t.value;render()}
  else if(t.id==='desc'&&draft){draft.desconto=num(t.value);$('#tot').textContent=brl(totalDraft().tot)}
  else if(t.id==='taxa'&&draft){draft.taxa=num(t.value);$('#tot').textContent=brl(totalDraft().tot)}
  else if(t.dataset&&t.dataset.ci!==undefined&&catsDraft[+t.dataset.ci]){catsDraft[+t.dataset.ci].nome=t.value}
  else if(t.id==='corCustom'&&tPrev){tPrev.acento=t.value;applyTema();drawCores()}
});
function fillEnd(){
  var s=document.querySelector('select[name=cliente]'), en=$('#end'), c=s&&by('clientes',s.value);
  if(c&&c.endereco&&en&&!en.value)en.value=c.endereco;
}
document.addEventListener('change',function(e){
  var t=e.target;
  if(t.id==='dia'){S.dia=t.value||hoje();render()}
  else if(t.id==='de'||t.id==='ate'){S[t.id]=t.value||hoje();render()}
  else if(t.id==='tipo'&&draft){draft.tipo=t.value;$('#entbox').hidden=t.value!=='Entrega';if(t.value==='Entrega')fillEnd();$('#tot').textContent=brl(totalDraft().tot)}
  else if(t.name==='cliente'&&draft&&draft.tipo==='Entrega'){fillEnd()}
  else if(t.id==='logoFile'&&t.files&&t.files[0]){
    lerLogo(t.files[0]).then(function(u){
      if(u.length>200000){toast('Imagem muito grande. Use um logo menor.');return}
      logoDraft=u;logoPrev();
    }).catch(function(){toast('Não foi possível ler essa imagem.')});
  }
  else if(t.id==='modo'&&tPrev){tPrev.modo=t.value;applyTema()}
});
document.addEventListener('keydown',function(e){
  if(e.key==='Enter'&&e.target.id==='iq'){e.preventDefault();ACT['add-item']()}
  if(e.key==='Escape'&&!$('#modal').hidden)closeModal();
});

/* ---------- início ---------- */
var h0=(location.hash||'').slice(1);if(VIEWS[h0])S.tab=h0;
render();
(function(){
  var cfg=window.ZEPPELIN_CONFIG||{};
  if(!cfg.url||!cfg.anonKey||/COLE_AQUI/.test(cfg.url+cfg.anonKey)){
    fatal='<div class="empty"><b>Falta configurar o Supabase</b>O arquivo config.js ainda está com os valores de exemplo. No GitHub, abra o arquivo config.js, clique no lápis (Edit), cole a URL e a chave anon do seu projeto Supabase (Project Settings &gt; API) e clique em Commit changes. O site atualiza em cerca de 1 minuto. Depois, atualize esta página com Ctrl+F5.</div>';
    render();return;
  }
  if(!window.supabase){fatal='<div class="empty"><b>Não foi possível carregar o Supabase</b>Verifique a conexão com a internet e recarregue a página com Ctrl+F5.</div>';render();return}
  sb=window.supabase.createClient(cfg.url,cfg.anonKey);
  $('#lf').addEventListener('submit',function(e){
    e.preventDefault();
    var err=$('#lerr');err.hidden=true;
    sb.auth.signInWithPassword({email:$('#le').value.trim(),password:$('#lp').value}).then(function(r){
      if(r.error){err.textContent='E-mail ou senha incorretos.';err.hidden=false}else{$('#lp').value=''}
    });
  });
  sb.auth.getSession().then(function(r){entrar(r.data&&r.data.session)});
  sb.auth.onAuthStateChange(function(ev,session){entrar(session)});
  document.addEventListener('visibilitychange',function(){if(!document.hidden)agendar()});
})();
})();
