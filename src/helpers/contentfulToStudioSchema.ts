import Case from 'case'
import {stringify} from 'javascript-stringify'
import compact from 'just-compact'
import prettier from 'prettier'

import {stringFieldSchemaFactory} from '../helpers/sanity/fieldSchemaFactories'
import {ContentfulExport, SanityDocumentSchema, SanityObjectSchema} from '../types'
import {contentfulTypeToSanitySchema} from '../utils/contentfulTypeToSanitySchema'
import {ContentfulNoDefaultLocaleError} from './errors/ContentfulNoDefaultLocaleError'
import {serializeRuleSpecToCode} from './sanity/serializeRuleSpecToCode'

export async function contentfulToStudioSchema(
  data: ContentfulExport,
  opts: {
    typescript: boolean
    intlMode: 'single' | 'multiple'
    keepMarkdown: boolean
    filepath: string
  },
): Promise<string> {
  const schemas: (SanityDocumentSchema | SanityObjectSchema)[] = compact(
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    data.contentTypes!.map((type) => data && contentfulTypeToSanitySchema(type, data, opts)),
  )

  // add object break schema
  if (
    data.editorInterfaces?.some((editor) =>
      editor.controls?.some((ctrl) => ctrl.widgetId === 'richTextEditor'),
    )
  ) {
    const alreadyHasBreakSchema = schemas.some(({name}) => name === 'break')
    if (alreadyHasBreakSchema) {
      // eslint-disable-next-line no-console
      console.warn(
        'Found user-defined content model called "break". Be aware this could result in broken portable text',
      )
    }

    if (!alreadyHasBreakSchema) {
      schemas.push({
        name: 'break',
        title: 'Break',
        type: 'object',
        fields: [
          // @ts-expect-error - @TODO fix up the schema definitions
          stringFieldSchemaFactory('style')
            .options({
              list: [
                {title: 'Line break', value: 'lineBreak'},
                {title: 'Read more', value: 'readMore'},
              ],
            })
            .build(),
        ],
      })
    }
  }

  // add tag schema
  if (data.tags?.length) {
    const alreadyHasTagSchema = schemas.some(({name}) => name === 'tag')
    if (alreadyHasTagSchema) {
      // eslint-disable-next-line no-console
      console.warn(
        'Found user-defined content model called "tag". Please review manually as this could conflict with the tags data import from contentful',
      )
    }

    if (!alreadyHasTagSchema) {
      schemas.push({
        name: 'tag',
        title: 'Tag',
        type: 'document',
        fields: [
          // @ts-expect-error - @TODO fix up the schema definitions
          stringFieldSchemaFactory('name')
            .title('Name')
            .validation([{flag: 'presence', constraint: 'required'}])
            .build(),
        ],
      })
    }
  }

  const useMultiLocale = opts.intlMode === 'multiple'
  const defaultLocale = data.locales?.find((locale) => Boolean(locale.default))
  if (!defaultLocale) {
    throw new ContentfulNoDefaultLocaleError()
  }

  const allSchemaTypes = schemas.map((schema) => {
    const identifier = `${Case.camel(schema.name)}Type`
    const stringifiedDefinition = stringify(schema, (value, space, next, key) => {
      if (key === 'validation') {
        if (Array.isArray(value) && value.length > 0) {
          return `Rule => Rule.${value.map((r) => serializeRuleSpecToCode(r)).join('.')}`
        }

        return
      }

      if (opts.typescript && key === 'fields') {
        if (Array.isArray(value) && value.length > 0) {
          return `[${value.map((v, k) => `defineField(${next(v, k)})`).join(',')}]`
        }

        return
      }

      if (key === 'initialValue') {
        if (useMultiLocale) {
          // eslint-disable-next-line no-warning-comments
          // @TODO
        } else {
          return next(value[defaultLocale.code], key)
        }
      }

      return next(value, key)
    })
    const definition = `
    export const ${schema.name}Type = ${
      opts.typescript ? `defineType(${stringifiedDefinition})` : stringifiedDefinition
    };`
    return {identifier, definition}
  })

  const typesConcatList = allSchemaTypes.map((t) => `  ${t.identifier},`).join('\n')

  const result = `// generated by contentful-to-sanity
${
  opts.typescript
    ? 'import {defineField, defineType, type SchemaTypeDefinition} from "sanity";'
    : ''
}


${allSchemaTypes.map((t) => t.definition).join('\n\n')}


export const types = [
  ${typesConcatList}
] ${opts.typescript ? 'satisfies SchemaTypeDefinition[];' : ''}
  `
  return await formatWithPrettier(opts.filepath, result)
}

const formatWithPrettier = async (filepath: string, content: string) => {
  const config = await prettier.resolveConfig(filepath)

  return prettier.format(content, {
    ...config,
    filepath,
  })
}
