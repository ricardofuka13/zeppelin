# Zeppelin Gestão

Sistema de estoque, caixa, clientes e pedidos para a Zeppelin (pipas, fogos e afins).

- **Site:** HTML, CSS e JavaScript puros, publicado no GitHub Pages (gratuito).
- **Banco de dados e login:** Supabase (gratuito para o tamanho de uma loja).
- **PDF do pedido, recibo para WhatsApp, relatórios, entregas, categorias e cores** já estão incluídos.

```
index.html            tela
styles.css            visual
app.js                lógica do sistema
config.js             URL e chave pública do seu Supabase (você preenche)
supabase/schema.sql   tabelas, regras de segurança e funções do banco
.github/workflows/    publicação automática no GitHub Pages
```

## Passo a passo

### 1. Criar o projeto no Supabase

1. Em [supabase.com](https://supabase.com), crie uma conta e um projeto novo (guarde a senha do banco).
2. Abra **SQL Editor > New query**, cole todo o conteúdo de `supabase/schema.sql` e clique em **Run**.
   Isso cria as tabelas, as regras de segurança e as funções que baixam o estoque e lançam o caixa.
3. Vá em **Authentication > Providers > Email** e desative **Allow new users to sign up**
   (assim só entra quem você cadastrar). Se o Supabase pedir confirmação de e-mail, deixe ativada.
4. Vá em **Authentication > Users > Add user > Create new user**, informe e-mail e senha e marque
   **Auto Confirm User**. Crie um usuário para cada pessoa que vai usar o sistema.
5. Vá em **Project Settings > API** e copie a **Project URL** e a chave **anon / publishable**.
6. Abra o arquivo `config.js` e cole os dois valores. A chave anon é pública por desenho:
   quem protege os dados são o login e as regras (RLS) do `schema.sql`.
   **Nunca** coloque a chave `service_role` no site.

### 2. Subir para o GitHub

1. Em [github.com/new](https://github.com/new), crie um repositório (por exemplo `zeppelin`).
2. Envie os arquivos desta pasta:

   ```bash
   git init
   git add .
   git commit -m "Sistema Zeppelin"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/zeppelin.git
   git push -u origin main
   ```

3. No repositório, vá em **Settings > Pages** e, em **Source**, escolha **GitHub Actions**.
4. Em **Actions**, aguarde o fluxo "Publicar no GitHub Pages" terminar. O endereço do site aparece
   nele e em Settings > Pages (algo como `https://SEU-USUARIO.github.io/zeppelin/`).

### 3. Usar

Abra o endereço, entre com o e-mail e a senha criados no passo 1.4 e, na primeira vez:

1. **Resumo > Dados da loja:** nome, telefone, chave Pix e logo (aparecem no recibo e no PDF).
2. **Estoque > Categorias** e **Novo produto** (ou "Carregar produtos de exemplo").
3. **Resumo > Aparência:** cor dos botões e fundo.

## Testar no computador

```bash
python3 -m http.server 8000
```

Abra `http://localhost:8000`. O `config.js` precisa estar preenchido.

## Observações

- O site no GitHub Pages é público, mas **sem login ninguém vê dado nenhum**: todas as tabelas têm
  RLS e só aceitam usuários autenticados.
- Todo usuário logado tem acesso total. Para a loja, isso costuma bastar. Se precisar separar
  permissões (por exemplo, caixa só para o dono), ajuste as políticas no `schema.sql`.
- Vendas, baixa de estoque, recebimento de fiado e cancelamento são feitos por funções do banco
  (`criar_pedido`, `receber_pedido`, `cancelar_pedido`), em uma única operação. O preço, o custo e o
  total são calculados no banco, e o estoque nunca fica negativo.
- A tela carrega os 1.500 pedidos e os 4.000 lançamentos de caixa mais recentes. Se a loja crescer
  muito, o próximo passo é filtrar por período no banco.
- Faça backup: **Database > Backups** no Supabase, ou exporte as tabelas em CSV.
- O plano gratuito do Supabase pausa projetos sem uso por cerca de uma semana. Abra o sistema de vez
  em quando ou considere o plano pago.
