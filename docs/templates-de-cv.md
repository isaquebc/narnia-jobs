# Modelos de currículo (templates do usuário)

Além dos três modelos do narnia-jobs (Clássico, Moderno e Compacto), você pode enviar o seu em **Configurações › Modelos de currículo**. O modelo é validado (a tela mostra os motivos quando algo não passa), monta um CV de exemplo como prévia e, válido, aparece no seletor **Modelo** do painel de cada currículo.

## O que vai no `.zip`

| Arquivo | Obrigatório | Conteúdo |
|---------|-------------|----------|
| `template.html` | sim | o corpo do documento em [Handlebars](https://handlebarsjs.com/), sem `<html>`, `<head>` nem `<body>` |
| `style.css` | sim | o estilo (pode ser vazio); `@page` define as margens |
| `manifest.json` | sim | `{"name": "Meu modelo", "version": "1.0", "locales": ["pt-BR", "en-US"], "paper": ["A4"], "kinds": ["cv"]}` (`name` é o único campo sem padrão) |
| imagens e fontes | não | `.png`, `.jpg`, `.svg` e `.woff2`, referenciados por caminho relativo (`./logo.png`, `fonts/minha.woff2`) |

Limites: até 5 MB (15 MB descompactado, 60 arquivos), só caminhos relativos e sem `..`, só as extensões acima.

## Segurança (o que é recusado)

O modelo monta o documento sem JavaScript e sem acesso à rede: tudo o que ele usa vai dentro do `.zip`. Por isso são recusados `<script>`, atributos de evento (`onclick`, `onload`…), links `javascript:`, `<iframe>`, `<object>`, `<embed>`, `<link>`, `<base>`, `<meta>` e `<form>`, `@import` e `url()` para endereços externos no CSS, e SVG com script. Os dados do CV entram escapados (`{{ }}`), e o HTML final ainda passa por uma lista de tags e atributos permitidos.

## Dados disponíveis

O modelo recebe o conteúdo do CV (o mesmo que os modelos padrão usam):

- `header`: `name`, `title`, `location`, `email`, `phone` e `links` (cada um com `kind`, `url` e `label`; `kind` é `email`, `whatsapp`, `linkedin`, `github`, `portfolio` ou `other`)
- `summary`
- `experiences`: `company`, `title`, `start`, `end` (vazio = atual), `location`, `bullets` (cada um com `text`), `tech`
- `skills`: grupos com `label` e `items` (cada um com `name`)
- `projects`: `name`, `description`, `url`, `tech`
- `education`: `institution`, `course`, `degree`, `start`, `end`
- `languages`: `name`, `level`
- `sectionsOrder`: a ordem das seções escolhida (`summary`, `experience`, `skills`, `projects`, `education`, `languages`)
- `meta.locale`: `pt-BR` ou `en-US`

## Helpers

| Helper | Uso | Resultado |
|--------|-----|-----------|
| `t` | `{{t "experience"}}` | rótulo da seção no idioma do documento (Experiência / Experience) |
| `period` | `{{period start end}}` | "mar 2021 – atual" / "Mar 2021 – Present" |
| `date` | `{{date start}}` | "mar 2021" |
| `join` | `{{join tech ", "}}` | lista separada |
| `level` | `{{level level}}` | nível do idioma ("nativo" / "Native"; CEFR como está) |

Outros helpers não compilam.

## Exemplo mínimo

```html
<header>
  <h1>{{header.name}}</h1>
  <p>{{header.title}}</p>
  <p>{{#each header.links}}<a href="{{url}}">{{label}}</a> {{/each}}{{header.phone}}</p>
</header>
<section><h2>{{t "summary"}}</h2><p>{{summary}}</p></section>
<section>
  <h2>{{t "experience"}}</h2>
  {{#each experiences}}
    <h3>{{title}} · {{company}}</h3>
    <p>{{period start end}}</p>
    <ul>{{#each bullets}}<li>{{text}}</li>{{/each}}</ul>
  {{/each}}
</section>
<section><h2>{{t "skills"}}</h2>{{#each skills}}<p>{{label}}: {{#each items}}{{name}}, {{/each}}</p>{{/each}}</section>
<section><h2>{{t "education"}}</h2>{{#each education}}<p>{{degree}} {{course}} · {{institution}}</p>{{/each}}</section>
<section><h2>{{t "languages"}}</h2><p>{{#each languages}}{{name}} ({{level level}}) {{/each}}</p></section>
```

Dica: a revisão automática confere a aderência a ATS (texto legível, títulos de seção reconhecíveis, contato, datas). Um modelo que esconde seções, o telefone ou as datas pode deixar o currículo abaixo dos 90% e com o alerta "não passou na revisão".
