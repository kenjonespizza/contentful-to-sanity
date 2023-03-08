import type {ContentfulExport} from 'contentful-export'
import {ContentFields, ContentTypeProps} from 'contentful-management'
import get from 'just-safe-get'

import {BuiltInContentfulEditors, IntlMode} from '@/constants'
import {
  arrayFieldSchemaFactory,
  blockFieldSchemaFactory,
  booleanFieldSchemaFactory,
  dateFieldSchemaFactory,
  datetimeFieldSchemaFactory,
  fileFieldSchemaFactory,
  geopointFieldSchemaFactory,
  imageFieldSchemaFactory,
  numberFieldSchemaFactory,
  referenceFieldSchemaFactory,
  slugFieldSchemaFactory,
  stringFieldSchemaFactory,
  textFieldSchemaFactory,
  urlFieldSchemaFactory,
} from '@/helpers/sanity/fieldSchemaFactories'
import {AnySanityFieldSchema, StringSanityFieldSchema} from '@/types'

import {contentfulFieldItemToSanityOfType} from './contentfulFieldItemToSanityOfType'
import {extractContentfulRichTextFieldParameters} from './extractContentfulRichTextFieldParameters'
import {extractValidationRulesFromContentfulField} from './extractValidationRulesFromContentfulField'
import {findEditorControlForField} from './findEditorControlForField'

type Flags = {
  'keep-markdown'?: boolean
  intl?: IntlMode
}

export function contentfulFieldToSanityField(
  contentType: ContentTypeProps,
  field: ContentFields,
  data: ContentfulExport,
  flags: Flags = {},
): AnySanityFieldSchema | null {
  const control = findEditorControlForField(field.id, contentType.sys.id, data)

  if (control) {
    const availableTypeIds = new Set((data.contentTypes ?? []).map((type) => type.sys.id))
    const widgetId =
      control.widgetId ||
      (get(BuiltInContentfulEditors, field.type) as BuiltInContentfulEditors | undefined)
    // @README the default value object is per locale, will be picked up in stringification
    const defaultValue = field.defaultValue
    const helpText = control.settings?.helpText as string | undefined
    let onlyAllowValues = field.validations?.find((validation) => Boolean(validation.in))?.in
    const validationRules = extractValidationRulesFromContentfulField(field)

    if (field.type === 'Symbol') {
      if (widgetId === 'urlEditor') {
        const factory = urlFieldSchemaFactory(field.id)
          .title(field.name)
          .hidden(field.disabled)
          .description(helpText)
          .initialValue(defaultValue)
          .validation([
            ...validationRules,
            {
              flag: 'uri',
              constraint: {
                options: {
                  allowCredentials: true,
                  allowRelative: true,
                  relativeOnly: false,
                  scheme: [/^http/, /^https/],
                },
              },
            },
          ])
        return factory.build()
      }

      if (widgetId === 'slugEditor') {
        const sourceField =
          (control.settings?.trackingFieldId as string | undefined) || contentType.displayField
        const factory = slugFieldSchemaFactory(field.id)
          .title(field.name)
          .hidden(field.disabled)
          .description(helpText)
          .initialValue(defaultValue)
          .validation(validationRules.filter((rule) => rule.flag !== 'unique'))
        factory.options({
          source: sourceField,
        })
        return factory.build()
      }

      const factory = stringFieldSchemaFactory(field.id)
        .title(field.name)
        .hidden(field.disabled)
        .description(helpText)
        .initialValue(defaultValue)
        .validation(validationRules)
      factory.options({
        list: onlyAllowValues?.length ? onlyAllowValues.map((v) => String(v)) : undefined,
        layout: widgetId === 'radio' || widgetId === 'dropdown' ? widgetId : undefined,
      })
      return factory.build()
    }

    if (field.type === 'Boolean') {
      const factory = booleanFieldSchemaFactory(field.id)
        .title(field.name)
        .hidden(field.disabled)
        .description(helpText)
        .initialValue(defaultValue)
        .validation(validationRules)
      if (control.settings?.trueLabel || control.settings?.falseLabel) {
        console.warn(`Custom True and False labels are not supported by default (${field.id})`)
      }

      return factory.build()
    }

    if (field.type === 'Date') {
      const ampm = (control.settings?.ampm ?? 24) as 12 | 24
      const format = (control.settings?.format ?? 'timeZ') as 'timeZ' | 'time' | 'dateonly'
      if (format === 'dateonly') {
        const factory = dateFieldSchemaFactory(field.id)
          .title(field.name)
          .hidden(field.disabled)
          .description(helpText)
          .initialValue(defaultValue)
          .validation(validationRules)
        return factory.build()
      }

      const factory = datetimeFieldSchemaFactory(field.id)
        .title(field.name)
        .hidden(field.disabled)
        .description(helpText)
        .initialValue(defaultValue)
        .validation(validationRules)
        .options({
          timeFormat: `${ampm === 12 ? 'h:mm a' : 'H:mm'}${format === 'timeZ' ? 'Z' : ''}`,
        })
      return factory.build()
    }

    if (field.type === 'Location') {
      // @README contentful does not support default geopoint value
      return geopointFieldSchemaFactory(field.id)
        .title(field.name)
        .hidden(field.disabled)
        .description(helpText)
        .validation(validationRules)
        .build()
    }

    if (field.type === 'Number' || field.type === 'Integer') {
      if (widgetId === 'rating' && !onlyAllowValues?.length) {
        const maxValue = Number(control.settings?.stars ?? 5)
        const onlyValues: number[] = []
        for (let i = 1; i <= maxValue; i++) {
          onlyValues.push(i)
        }

        onlyAllowValues = onlyValues
      }

      const factory = numberFieldSchemaFactory(field.id)
        .title(field.name)
        .hidden(field.disabled)
        .description(helpText)
        .initialValue(defaultValue)
        .validation(validationRules)
      factory.options({
        list: onlyAllowValues?.length
          ? onlyAllowValues.map((v) => Number.parseFloat(String(v)))
          : undefined,
        layout: widgetId === 'radio' || widgetId === 'dropdown' ? widgetId : undefined,
      })
      return factory.build()
    }

    if (field.type === 'Text') {
      if (widgetId === 'multipleLine' || (widgetId === 'markdown' && flags['keep-markdown'])) {
        return textFieldSchemaFactory(field.id)
          .title(field.name)
          .hidden(field.disabled)
          .description(helpText)
          .initialValue(defaultValue)
          .validation(validationRules)
          .build()
      }

      return arrayFieldSchemaFactory(field.id)
        .title(field.name)
        .hidden(field.disabled)
        .description(helpText)
        .initialValue(defaultValue)
        .validation(validationRules)
        .of([
          blockFieldSchemaFactory('block').anonymous(),
          imageFieldSchemaFactory('image').anonymous(),
        ])
        .build()
    }

    if (field.type === 'RichText') {
      const richTextOptions = extractContentfulRichTextFieldParameters(field, data)

      const blockFactory = blockFieldSchemaFactory('block')
        .styles(richTextOptions.styles)
        .lists(richTextOptions.lists)
        .marks(richTextOptions.marks)
      if (richTextOptions.canEmbedEntriesInline && richTextOptions.supportedEmbeddedInlineTypes) {
        blockFactory.of(
          richTextOptions.supportedEmbeddedInlineTypes.map((linkType) => ({
            type: linkType.type,
          })),
        )
      }

      const factory = arrayFieldSchemaFactory(field.id)
        .title(field.name)
        .hidden(field.disabled)
        .description(helpText)
        .initialValue(defaultValue)
        .validation(validationRules)
      factory.of([
        blockFactory.anonymous(),
        ...(richTextOptions.canEmbedEntries && richTextOptions.supportedEmbeddedBlockTypes
          ? richTextOptions.supportedEmbeddedBlockTypes.map((linkType) => ({
              type: linkType.type,
            }))
          : []),
        ...(richTextOptions.canEmbedAssets ? [{type: 'image'}, {type: 'file'}] : []),
        ...(richTextOptions.canUseBreaks ? [{type: 'break'}] : []),
      ])
      return factory.build()
    }

    if (field.type === 'Link') {
      const linkContentTypeValidation = field.validations?.find((validation) =>
        Boolean(validation.linkContentType),
      )
      const linkMimetypeGroupValidation = field.validations?.find((validation) =>
        Boolean(validation.linkMimetypeGroup),
      )

      if (field.linkType === 'Asset') {
        const onlyAcceptsImages =
          linkMimetypeGroupValidation?.linkMimetypeGroup?.includes('image') &&
          linkMimetypeGroupValidation?.linkMimetypeGroup.length === 1

        if (onlyAcceptsImages) {
          return imageFieldSchemaFactory(field.id)
            .title(field.name)
            .hidden(field.disabled)
            .description(helpText)
            .validation(validationRules)
            .build()
        }

        return fileFieldSchemaFactory(field.id)
          .title(field.name)
          .hidden(field.disabled)
          .description(helpText)
          .validation(validationRules)
          .build()
      }

      const factory = referenceFieldSchemaFactory(field.id)
        .title(field.name)
        .hidden(field.disabled)
        .description(helpText)
        .validation(validationRules)
      if (linkContentTypeValidation?.linkContentType?.length) {
        factory.to(
          linkContentTypeValidation.linkContentType
            .filter((type) => availableTypeIds.has(type))
            .map((type) => ({type})),
        )
      } else if (data.contentTypes) {
        factory.to(data.contentTypes.map((type) => ({type: type.sys.id})))
      }

      return factory.build()
    }

    if (field.type === 'Array') {
      const factory = arrayFieldSchemaFactory(field.id)
        .title(field.name)
        .hidden(field.disabled)
        .description(helpText)
        .validation(validationRules)

      if (widgetId === 'entryCardsEditor') {
        factory.options({layout: 'grid'})
      }

      if (widgetId === 'tagEditor') {
        factory.options({layout: 'tag'})
      }

      if (field.items) {
        const ofType = contentfulFieldItemToSanityOfType(field.items, data)
        if (ofType) {
          factory.of([ofType])

          const itemListValues = ofType.options?.list as Exclude<
            StringSanityFieldSchema['options'],
            undefined
          >['list']

          if (widgetId === 'checkbox' && itemListValues?.length) {
            factory.options({
              list: itemListValues.map((value) => ({
                value: typeof value === 'string' ? String(value) : value.value,
                title: typeof value === 'string' ? String(value) : value.title,
              })),
            })
          }
        }
      }

      return factory.build()
    }
  }

  return null
}