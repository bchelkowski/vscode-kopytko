/**
 * Roku SceneGraph node catalog.
 *
 * Each entry models one SceneGraph node type with its own fields and methods.
 * Inherited members are NOT duplicated here — use getAllSgNodeFields() /
 * getAllSgNodeMethods() to walk the extends chain.
 *
 * Sourced from the official Roku SceneGraph reference:
 *   https://developer.roku.com/docs/references/scenegraph/node-classes/node.md
 *
 * LAST VERIFIED AGAINST ROKU DOCS: 2026-06-05
 */

export interface SgNodeField {
  name: string;
  type: string;
  description: string;
  readonly?: boolean;
}

export interface SgNodeMethod {
  name: string;
  signature: string;
  returnType: string;
  description: string;
  interface: string;
  /** Minimum Roku OS version that supports this method */
  since?: string;
}

interface SgNodeDefinition {
  name: string;
  extends?: string;
  description: string;
  docsUrl: string;
  fields: SgNodeField[];
  methods: SgNodeMethod[];
}

export const SG_NODES: Record<string, SgNodeDefinition> = {

  // ── Base ─────────────────────────────────────────────────────────────────

  Node: {
    name: 'Node',
    description: 'Base node for all SceneGraph components.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/node.md',
    fields: [
      { name: 'id', type: 'string', description: 'Unique identifier for this node.' },
      { name: 'focusedChild', type: 'node', description: 'Currently focused child node.', readonly: true },
      { name: 'focusable', type: 'boolean', description: 'Whether this node can receive focus.' },
      { name: 'change', type: 'assocarray', description: 'Info about the most recently changed field.', readonly: true },
      { name: 'childRenderOrder', type: 'string', description: '"renderFirst" or "renderLast" — controls whether children render before or after this node.' },
      { name: 'inheritParentTransform', type: 'boolean', description: 'When true, applies the parent transform to this node.' },
    ],
    methods: [
      // ifSGNodeField
      { name: 'observeField', signature: 'observeField(fieldName as String, functionName as String) as Boolean', returnType: 'Boolean', description: 'Observe a field and call functionName when it changes.', interface: 'ifSGNodeField' },
      { name: 'unobserveField', signature: 'unobserveField(fieldName as String) as Boolean', returnType: 'Boolean', description: 'Stop observing a field.', interface: 'ifSGNodeField' },
      { name: 'observeFieldScoped', signature: 'observeFieldScoped(fieldName as String, functionName as String) as Boolean', returnType: 'Boolean', description: 'Observe a field; the observer is automatically removed when the component is destroyed.', interface: 'ifSGNodeField' },
      { name: 'unobserveFieldScoped', signature: 'unobserveFieldScoped(fieldName as String) as Boolean', returnType: 'Boolean', description: 'Stop a scoped field observation.', interface: 'ifSGNodeField' },
      { name: 'observeFieldScopedEx', signature: 'observeFieldScopedEx(fieldName as String, port as Object) as Boolean', returnType: 'Boolean', description: 'Observe a field via an roMessagePort; scoped to the observing component. Correctly monitors the observing component for improved memory usage.', interface: 'ifSGNodeField', since: '12.0' },
      { name: 'addField', signature: 'addField(fieldName as String, type as String, alwaysNotify as Boolean) as Boolean', returnType: 'Boolean', description: 'Adds a field with the specified name and type, initialized to the default value.', interface: 'ifSGNodeField' },
      { name: 'addFields', signature: 'addFields(fields as roAssociativeArray) as Boolean', returnType: 'Boolean', description: 'Add new fields to this node dynamically.', interface: 'ifSGNodeField' },
      { name: 'hasField', signature: 'hasField(fieldName as String) as Boolean', returnType: 'Boolean', description: 'Returns true if the field exists on this node.', interface: 'ifSGNodeField' },
      { name: 'removeField', signature: 'removeField(fieldName as String) as Boolean', returnType: 'Boolean', description: 'Remove a dynamically added field.', interface: 'ifSGNodeField' },
      { name: 'getFieldType', signature: 'getFieldType(fieldName as String) as String', returnType: 'String', description: 'Returns the type string of the named field.', interface: 'ifSGNodeField' },
      { name: 'getFieldTypes', signature: 'getFieldTypes() as Object', returnType: 'Object', description: 'Returns an roAssociativeArray with field names and their type strings.', interface: 'ifSGNodeField' },
      { name: 'getField', signature: 'getField(fieldName as String) as Dynamic', returnType: 'Dynamic', description: 'Returns the value of a field by name.', interface: 'ifSGNodeField' },
      { name: 'getFields', signature: 'getFields() as Object', returnType: 'Object', description: 'Returns an roAssociativeArray with field names and their values.', interface: 'ifSGNodeField' },
      { name: 'setField', signature: 'setField(fieldName as String, value as Dynamic) as Boolean', returnType: 'Boolean', description: 'Sets a field value by name.', interface: 'ifSGNodeField' },
      { name: 'setFields', signature: 'setFields(fields as roAssociativeArray) as Boolean', returnType: 'Boolean', description: 'Sets multiple field values at once.', interface: 'ifSGNodeField' },
      { name: 'update', signature: 'update(fields as roAssociativeArray, addFields as Boolean) as Void', returnType: 'Void', description: "Updates fields; if addFields is true, creates fields that don't exist.", interface: 'ifSGNodeField' },
      { name: 'queueFields', signature: 'queueFields(queueNode as Boolean) as Boolean', returnType: 'Boolean', description: 'Queues field operations on the node instead of executing immediately. Setting to false releases the queue to the render thread.', interface: 'ifSGNodeField', since: '15.0' },
      { name: 'MoveIntoField', signature: 'MoveIntoField(fieldName as String, data as Object) as Integer', returnType: 'Integer', description: 'Moves an associative array into a node field. The source is emptied after the move. Returns the count of nested objects that were copied instead of moved.', interface: 'ifSGNodeField', since: '15.0' },
      { name: 'MoveFromField', signature: 'MoveFromField(fieldName as String) as Object', returnType: 'Object', description: 'Moves an associative array out of a node field. The field is emptied after the move.', interface: 'ifSGNodeField', since: '15.0' },
      { name: 'SetRef', signature: 'SetRef(fieldName as String, data as Object) as Boolean', returnType: 'Boolean', description: 'Assigns an associative array to a field by reference. Render thread only. Observers are not notified.', interface: 'ifSGNodeField', since: '15.0' },
      { name: 'CanGetRef', signature: 'CanGetRef(fieldName as String) as Boolean', returnType: 'Boolean', description: 'Returns true if GetRef() will succeed for this field. Requires prior SetRef() call. Render thread only.', interface: 'ifSGNodeField', since: '15.0' },
      { name: 'GetRef', signature: 'GetRef(fieldName as String) as Object', returnType: 'Object', description: 'Returns a reference to the value of a field (must be an associative array set via SetRef). Render thread only.', interface: 'ifSGNodeField', since: '15.0' },
      // ifSGNodeChildren
      { name: 'appendChild', signature: 'appendChild(child as roSGNode) as Boolean', returnType: 'Boolean', description: 'Appends a child node to this node.', interface: 'ifSGNodeChildren' },
      { name: 'createChild', signature: 'createChild(subtype as String) as roSGNode', returnType: 'roSGNode', description: 'Creates and appends a child node of the given component type.', interface: 'ifSGNodeChildren' },
      { name: 'findNode', signature: 'findNode(id as String) as roSGNode', returnType: 'roSGNode', description: "Searches this node's subtree for a node with the given id.", interface: 'ifSGNodeChildren' },
      { name: 'getChild', signature: 'getChild(index as Integer) as roSGNode', returnType: 'roSGNode', description: 'Returns the child at the given index.', interface: 'ifSGNodeChildren' },
      { name: 'getChildCount', signature: 'getChildCount() as Integer', returnType: 'Integer', description: 'Returns the number of direct children.', interface: 'ifSGNodeChildren' },
      { name: 'getChildren', signature: 'getChildren(count as Integer, startIndex as Integer) as roArray', returnType: 'roArray', description: 'Returns an array of child nodes starting at startIndex.', interface: 'ifSGNodeChildren' },
      { name: 'insertChild', signature: 'insertChild(child as roSGNode, index as Integer) as Boolean', returnType: 'Boolean', description: 'Inserts a child at a specific index.', interface: 'ifSGNodeChildren' },
      { name: 'removeChild', signature: 'removeChild(child as roSGNode) as Boolean', returnType: 'Boolean', description: 'Removes a child node.', interface: 'ifSGNodeChildren' },
      { name: 'removeChildAtIndex', signature: 'removeChildAtIndex(index as Integer) as Boolean', returnType: 'Boolean', description: 'Removes the child at the given index.', interface: 'ifSGNodeChildren' },
      { name: 'replaceChild', signature: 'replaceChild(newChild as roSGNode, index as Integer) as Boolean', returnType: 'Boolean', description: 'Replaces the child at the given index with newChild.', interface: 'ifSGNodeChildren' },
      { name: 'isInSubtree', signature: 'isInSubtree(node as roSGNode) as Boolean', returnType: 'Boolean', description: "Returns true if node is in this node's subtree.", interface: 'ifSGNodeChildren' },
      { name: 'reparentNode', signature: 'reparentNode(newParent as roSGNode, adjustTransform as Boolean) as Boolean', returnType: 'Boolean', description: 'Moves this node to a new parent.', interface: 'ifSGNodeChildren' },
      { name: 'setParent', signature: 'setParent(parent as roSGNode, adjustTransform as Boolean) as Boolean', returnType: 'Boolean', description: 'Sets the parent of this node.', interface: 'ifSGNodeChildren' },
      { name: 'getParent', signature: 'getParent() as roSGNode', returnType: 'roSGNode', description: "Returns this node's parent.", interface: 'ifSGNodeChildren' },
      { name: 'getParents', signature: 'getParents() as roArray', returnType: 'roArray', description: 'Returns an array of all ancestor nodes up to the scene root.', interface: 'ifSGNodeChildren' },
      { name: 'getScene', signature: 'getScene() as roSGNode', returnType: 'roSGNode', description: "Returns the Scene node that is the root of this node's scene graph.", interface: 'ifSGNodeChildren' },
      // ifSGNodeFocus
      { name: 'setFocus', signature: 'setFocus(enable as Boolean) as Boolean', returnType: 'Boolean', description: 'Sets or removes focus from this node.', interface: 'ifSGNodeFocus' },
      { name: 'hasFocus', signature: 'hasFocus() as Boolean', returnType: 'Boolean', description: 'Returns true if this node currently has focus.', interface: 'ifSGNodeFocus' },
    ],
  },

  // ── Visual nodes ─────────────────────────────────────────────────────────

  Group: {
    name: 'Group',
    extends: 'Node',
    description: 'A renderable node that can contain other nodes.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/group.md',
    fields: [
      { name: 'visible', type: 'boolean', description: 'Whether this node and its children are rendered.' },
      { name: 'opacity', type: 'float', description: 'Opacity from 0.0 (transparent) to 1.0 (opaque).' },
      { name: 'translation', type: 'array', description: '[x, y] translation offset in pixels.' },
      { name: 'rotation', type: 'float', description: 'Rotation in radians.' },
      { name: 'scale', type: 'array', description: '[scaleX, scaleY] scale factors.' },
      { name: 'scaleRotateCenter', type: 'array', description: '[x, y] point around which rotation and scale are applied.' },
      { name: 'clippingRect', type: 'array', description: '[x, y, width, height] clipping rectangle; children outside are not rendered.' },
      { name: 'renderPass', type: 'integer', description: '0 = normal render; positive integers place the node in overlay render passes.' },
      { name: 'muteAudioGuide', type: 'boolean', description: 'When true, prevents the audio guide from reading this subtree.' },
      { name: 'inheritParentOpacity', type: 'boolean', description: "When true, multiplies this node's opacity with the parent's effective opacity." },
      { name: 'enableRenderTracking', type: 'boolean', description: 'When true, activates renderTracking reporting for this node.' },
      { name: 'renderTracking', type: 'string', description: '"disabled", "partial", or "full" — reports how much of the node is visible on screen.', readonly: true },
    ],
    methods: [],
  },

  LayoutGroup: {
    name: 'LayoutGroup',
    extends: 'Group',
    description: 'A Group that arranges its children in a horizontal or vertical stack.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/layoutgroup.md',
    fields: [
      { name: 'layoutDirection', type: 'string', description: '"horiz" or "vert" — direction children are arranged.' },
      { name: 'horizAlignment', type: 'string', description: '"left", "right", or "center" — horizontal alignment of children.' },
      { name: 'vertAlignment', type: 'string', description: '"top", "bottom", or "center" — vertical alignment of children.' },
      { name: 'itemSpacings', type: 'array', description: 'Array of spacing values (pixels) between each pair of adjacent children.' },
      { name: 'addItemSpacing', type: 'float', description: 'Spacing (pixels) added between each child when itemSpacings is empty.' },
      { name: 'numItems', type: 'integer', description: 'Number of children currently in the layout.', readonly: true },
    ],
    methods: [],
  },

  MaskGroup: {
    name: 'MaskGroup',
    extends: 'Group',
    description: 'Applies an alpha mask bitmap over all children.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/maskgroup.md',
    fields: [
      { name: 'maskUri', type: 'uri', description: 'URI of the alpha mask bitmap.' },
      { name: 'maskSize', type: 'array', description: 'Scaling factor [x, y] for the mask; [0,0] uses actual size.' },
      { name: 'maskOffset', type: 'array', description: 'Offset [x, y] of the mask relative to the group.' },
      { name: 'maskBitmapWidth', type: 'float', description: 'Pixel width of the loaded mask bitmap.', readonly: true },
      { name: 'maskBitmapHeight', type: 'float', description: 'Pixel height of the loaded mask bitmap.', readonly: true },
    ],
    methods: [],
  },

  TargetGroup: {
    name: 'TargetGroup',
    extends: 'Group',
    description: 'Renders items using flexible target regions defined by TargetSet nodes.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/targetgroup.md',
    fields: [
      { name: 'itemComponentName', type: 'string', description: 'Component used to render each item.' },
      { name: 'content', type: 'node', description: 'Content data for the group items.' },
      { name: 'targetSet', type: 'node', description: 'The TargetSet defining target regions.' },
      { name: 'defaultTargetSetFocusIndex', type: 'integer', description: 'Focus-region index for TargetSets without their own focusIndex.' },
      { name: 'wrap', type: 'boolean', description: 'Whether items wrap around at the edges.' },
      { name: 'duration', type: 'float', description: 'Duration of animations in seconds.' },
      { name: 'showTargetRects', type: 'boolean', description: 'Draws target rectangles for debugging.' },
      { name: 'easeFunction', type: 'string', description: 'Easing function for animations.' },
      { name: 'currFocusItemIndex', type: 'float', description: 'Floating-point index of the focused item during animation.', readonly: true },
      { name: 'itemSelected', type: 'integer', description: 'Index of the last selected item.', readonly: true },
      { name: 'itemFocused', type: 'integer', description: 'Index of the item that gained focus.', readonly: true },
      { name: 'itemUnfocused', type: 'integer', description: 'Index of the item that lost focus.', readonly: true },
      { name: 'jumpToItem', type: 'integer', description: 'Immediately position to the specified item.' },
      { name: 'animateToItem', type: 'integer', description: 'Animate to the specified item.' },
    ],
    methods: [],
  },

  TargetList: {
    name: 'TargetList',
    extends: 'TargetGroup',
    description: 'A TargetGroup configured as a scrollable list with focused/unfocused target sets.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/targetlist.md',
    fields: [
      { name: 'focusedTargetSet', type: 'array', description: 'TargetSets defining layouts when the list has focus.' },
      { name: 'unfocusedTargetSet', type: 'node', description: 'TargetSet defining layouts when the list lacks focus.' },
      { name: 'advanceKey', type: 'string', description: 'Remote button to move focus forward.' },
      { name: 'reverseKey', type: 'string', description: 'Remote button to move focus backward.' },
    ],
    methods: [],
  },

  TargetSet: {
    name: 'TargetSet',
    extends: 'Node',
    description: 'Defines rectangular target regions for TargetGroup items.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/targetset.md',
    fields: [
      { name: 'targetRects', type: 'array', description: 'Array of {x, y, width, height} rectangles.' },
      { name: 'focusIndex', type: 'integer', description: 'Index of the focus region; -1 leaves current index unchanged.' },
      { name: 'color', type: 'string', description: 'Color for debug target rectangles.' },
    ],
    methods: [],
  },

  Rectangle: {
    name: 'Rectangle',
    extends: 'Group',
    description: 'Renders a filled rectangle.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/rectangle.md',
    fields: [
      { name: 'width', type: 'float', description: 'Width of the rectangle in pixels.' },
      { name: 'height', type: 'float', description: 'Height of the rectangle in pixels.' },
      { name: 'color', type: 'string', description: 'Fill color as a hex RGBA string, e.g. "#FF0000FF".' },
      { name: 'blendingEnabled', type: 'boolean', description: 'When true, the color alpha channel is used for blending.' },
    ],
    methods: [],
  },

  // ── Label nodes ──────────────────────────────────────────────────────────

  LabelBase: {
    name: 'LabelBase',
    extends: 'Group',
    description: 'Abstract base class for Label and MultiStyleLabel. Provides text layout, alignment, wrapping, and truncation.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/abstract-nodes/labelbase.md',
    fields: [
      { name: 'text', type: 'string', description: 'The text string to display.' },
      { name: 'color', type: 'string', description: 'Text color as a hex RGBA string.' },
      { name: 'monospacedDigits', type: 'boolean', description: 'Renders numeric values using tabular (fixed-width) fonts.' },
      { name: 'horizAlign', type: 'string', description: '"left", "right", or "center".' },
      { name: 'vertAlign', type: 'string', description: '"top", "bottom", or "center".' },
      { name: 'width', type: 'float', description: 'Bounding width in pixels.' },
      { name: 'height', type: 'float', description: 'Bounding height in pixels.' },
      { name: 'numLines', type: 'integer', description: 'Number of lines to allocate space for.' },
      { name: 'maxLines', type: 'integer', description: 'Maximum lines to render; 0 = no limit.' },
      { name: 'wrap', type: 'boolean', description: 'When true, text wraps when it exceeds width.' },
      { name: 'displayPartialLines', type: 'boolean', description: 'When true, the last visible line may be clipped vertically.' },
      { name: 'ellipsizeOnBoundary', type: 'boolean', description: 'When true, text is ellipsized by whole words instead of characters.' },
      { name: 'wordBreakChars', type: 'string', description: 'Characters treated as word-break opportunities.' },
      { name: 'ellipsisText', type: 'string', description: 'String appended when text is truncated. Default "…".' },
      { name: 'isTextEllipsized', type: 'boolean', description: 'True if the rendered text was truncated.', readonly: true },
    ],
    methods: [],
  },

  Label: {
    name: 'Label',
    extends: 'LabelBase',
    description: 'Renders a text string.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/label.md',
    fields: [
      { name: 'font', type: 'node', description: 'Font node reference.' },
      { name: 'lineSpacing', type: 'float', description: 'Spacing in pixels between lines.' },
      { name: 'paragraphSpacing', type: 'float', description: 'Additional spacing after a paragraph break.' },
      { name: 'truncateOnDelimiter', type: 'string', description: 'Set of characters used as truncation boundaries.' },
      { name: 'leadingEllipsis', type: 'boolean', description: 'When true, truncation shows the end of the text with a leading ellipsis instead of the start.' },
      { name: 'wrappedLines', type: 'integer', description: 'Number of lines the text wrapped to.', readonly: true },
    ],
    methods: [],
  },

  ScrollingLabel: {
    name: 'ScrollingLabel',
    extends: 'Group',
    description: 'A Label that scrolls horizontally when text exceeds width.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/scrollinglabel.md',
    fields: [
      { name: 'text', type: 'string', description: 'The text to display.' },
      { name: 'color', type: 'string', description: 'Text color as a hex RGBA string.' },
      { name: 'font', type: 'node', description: 'Font node reference.' },
      { name: 'horizAlign', type: 'string', description: '"left", "right", or "center".' },
      { name: 'vertAlign', type: 'string', description: '"top", "bottom", or "center".' },
      { name: 'width', type: 'float', description: 'Width of the visible area in pixels.' },
      { name: 'delay', type: 'float', description: 'Seconds before scrolling starts.' },
      { name: 'speed', type: 'float', description: 'Scroll speed in pixels per second.' },
      { name: 'repeatCount', type: 'integer', description: 'Number of scroll repetitions; -1 = infinite.' },
    ],
    methods: [],
  },

  SimpleLabel: {
    name: 'SimpleLabel',
    extends: 'Node',
    description: 'A lightweight label without layout features, for performance-critical components.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/simplelabel.md',
    fields: [
      { name: 'text', type: 'string', description: 'The text to display.' },
      { name: 'color', type: 'string', description: 'Text color as a hex RGBA string.' },
      { name: 'font', type: 'node', description: 'Font node reference.' },
      { name: 'horizAlign', type: 'string', description: '"left", "right", or "center".' },
      { name: 'vertAlign', type: 'string', description: '"top", "bottom", or "center".' },
      { name: 'width', type: 'float', description: 'Bounding width in pixels.' },
      { name: 'height', type: 'float', description: 'Bounding height in pixels.' },
      { name: 'translation', type: 'array', description: '[x, y] translation in pixels.' },
      { name: 'visible', type: 'boolean', description: 'When false, the label is not rendered.' },
    ],
    methods: [],
  },

  MultiStyleLabel: {
    name: 'MultiStyleLabel',
    extends: 'LabelBase',
    description: 'Displays text with mixed styles using markup tags and named drawing styles.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/multi-style-label.md',
    fields: [
      { name: 'drawingStyles', type: 'assocarray', description: 'Named font styles (fontSize, fontUri, color) applied via markup tags.' },
    ],
    methods: [],
  },

  MonospaceLabel: {
    name: 'MonospaceLabel',
    extends: 'Group',
    description: 'Renders text with fixed-width characters for alignment. Available since Roku OS 14.0.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/monospace-label.md',
    fields: [
      { name: 'text', type: 'string', description: 'The text to display.' },
      { name: 'color', type: 'string', description: 'Text color.' },
      { name: 'font', type: 'node', description: 'Font node reference.' },
      { name: 'horizAlign', type: 'string', description: '"left", "right", or "center".' },
      { name: 'vertAlign', type: 'string', description: '"top", "bottom", or "center".' },
      { name: 'width', type: 'float', description: 'Bounding width in pixels.' },
      { name: 'height', type: 'float', description: 'Bounding height in pixels.' },
      { name: 'characterWidth', type: 'float', description: 'Fixed width per character; 0 uses the width of "M".' },
      { name: 'ellipsizeOnBoundary', type: 'boolean', description: 'When true, text is ellipsized by whole words.' },
      { name: 'firstCharTrueLeftAlign', type: 'boolean', description: 'Forces first character to fully left-align.' },
      { name: 'wordBreakChars', type: 'string', description: 'Additional characters for line-break positions.' },
      { name: 'isTextEllipsized', type: 'boolean', description: 'True if the text was truncated.', readonly: true },
    ],
    methods: [],
  },

  Poster: {
    name: 'Poster',
    extends: 'Group',
    description: 'Displays a bitmap image loaded from a URI.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/poster.md',
    fields: [
      { name: 'uri', type: 'uri', description: 'URL or pkg:/ path of the image to display.' },
      { name: 'width', type: 'float', description: 'Display width in pixels.' },
      { name: 'height', type: 'float', description: 'Display height in pixels.' },
      { name: 'loadWidth', type: 'float', description: 'Decode width hint in pixels.' },
      { name: 'loadHeight', type: 'float', description: 'Decode height hint in pixels.' },
      { name: 'loadDisplayMode', type: 'string', description: '"noScale", "limitSize", "limitAll", "scaleToFit", "scaleToFill", or "zoomToFill".' },
      { name: 'failedBitmapUri', type: 'uri', description: 'Image shown when the main uri fails to load.' },
      { name: 'failedBitmapOpacity', type: 'float', description: 'Opacity of the failed bitmap (0.0–1.0).' },
      { name: 'loadingBitmapUri', type: 'uri', description: 'Image shown while the main uri is loading.' },
      { name: 'loadingBitmapOpacity', type: 'float', description: 'Opacity of the loading bitmap (0.0–1.0).' },
      { name: 'bitmapWidth', type: 'float', description: 'Decoded bitmap width in pixels.', readonly: true },
      { name: 'bitmapHeight', type: 'float', description: 'Decoded bitmap height in pixels.', readonly: true },
      { name: 'bitmapMargins', type: 'assocarray', description: '9-patch margin info, or zeros if not a 9-patch image.', readonly: true },
      { name: 'loadStatus', type: 'string', description: '"noimage", "loading", "ready", or "failed".', readonly: true },
      { name: 'blendColor', type: 'string', description: 'Color to blend with the bitmap.' },
      { name: 'audioGuideText', type: 'string', description: 'Text read by the audio guide in place of the image.' },
      { name: 'loadSync', type: 'boolean', description: 'When true, blocks rendering until the image is loaded.' },
      { name: 'loadOnFocus', type: 'boolean', description: 'When true, the image is only loaded when this node has focus.' },
    ],
    methods: [],
  },

  // ── Media ─────────────────────────────────────────────────────────────────

  Video: {
    name: 'Video',
    extends: 'Group',
    description: 'Plays streaming or local video content.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/video.md',
    fields: [
      { name: 'content', type: 'node', description: 'ContentNode with stream metadata.' },
      { name: 'contentIndex', type: 'integer', description: 'Index into the content playlist to play.' },
      { name: 'control', type: 'string', description: 'Write "play", "stop", "pause", "resume", or "prebuffer".' },
      { name: 'state', type: 'string', description: '"none", "buffering", "playing", "paused", "stopped", "finished", or "error".', readonly: true },
      { name: 'position', type: 'float', description: 'Current playback position in seconds.', readonly: true },
      { name: 'duration', type: 'float', description: 'Total duration in seconds.', readonly: true },
      { name: 'seek', type: 'float', description: 'Write a position in seconds to seek to that point.' },
      { name: 'loop', type: 'boolean', description: 'When true, the stream restarts after finishing.' },
      { name: 'mute', type: 'boolean', description: 'When true, audio is muted.' },
      { name: 'error', type: 'boolean', description: 'True when a playback error has occurred.', readonly: true },
      { name: 'errorStr', type: 'string', description: 'Human-readable error message.', readonly: true },
      { name: 'enableUI', type: 'boolean', description: 'When true, the default buffering/playback UI is shown.' },
      { name: 'streamInfo', type: 'assocarray', description: 'Information about the current stream.', readonly: true },
      { name: 'streamBandwidth', type: 'integer', description: 'Current stream bandwidth in bits per second.', readonly: true },
      { name: 'subtitleConfig', type: 'assocarray', description: 'Subtitle configuration.' },
      { name: 'subtitleUrl', type: 'uri', description: 'URL of the subtitle file.' },
      { name: 'availableAudioTracks', type: 'array', description: 'Available audio tracks.', readonly: true },
      { name: 'availableSubtitleTracks', type: 'array', description: 'Available subtitle tracks.', readonly: true },
      { name: 'preferredAudioTrack', type: 'integer', description: 'Index of the preferred audio track.' },
      { name: 'subtitleTrack', type: 'integer', description: 'Index of the selected subtitle track.' },
      { name: 'framerate', type: 'float', description: 'Current playback framerate.', readonly: true },
      { name: 'timeToStartStreaming', type: 'float', description: 'Time in seconds from play request to first frame.', readonly: true },
      { name: 'maxVideoDecodeResolution', type: 'assocarray', description: 'Maximum video decode resolution {w, h}.' },
      { name: 'globalCacheLimit', type: 'integer', description: 'Maximum size of the download buffer in bytes.' },
    ],
    methods: [],
  },

  Audio: {
    name: 'Audio',
    extends: 'Node',
    description: 'Plays audio streams.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/audio.md',
    fields: [
      { name: 'content', type: 'node', description: 'ContentNode with audio stream metadata.' },
      { name: 'control', type: 'string', description: 'Write "play", "stop", "pause", or "resume".' },
      { name: 'state', type: 'string', description: '"none", "buffering", "playing", "paused", "stopped", "finished", or "error".', readonly: true },
      { name: 'position', type: 'float', description: 'Current playback position in seconds.', readonly: true },
      { name: 'duration', type: 'float', description: 'Total duration in seconds.', readonly: true },
      { name: 'seek', type: 'float', description: 'Write a position in seconds to seek.' },
      { name: 'loop', type: 'boolean', description: 'When true, the audio loops after finishing.' },
      { name: 'mute', type: 'boolean', description: 'When true, audio is muted.' },
      { name: 'error', type: 'boolean', description: 'True when a playback error occurred.', readonly: true },
      { name: 'errorStr', type: 'string', description: 'Human-readable error message.', readonly: true },
    ],
    methods: [],
  },

  // ── Media & utility ───────────────────────────────────────────────────────

  SoundEffect: {
    name: 'SoundEffect',
    extends: 'Node',
    description: 'Plays a WAV audio file for UI sound effects.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/soundeffect.md',
    fields: [
      { name: 'uri', type: 'uri', description: 'URI of the WAV file.' },
      { name: 'control', type: 'string', description: '"play" to start playback.' },
      { name: 'state', type: 'string', description: 'Current playback state.', readonly: true },
      { name: 'loadStatus', type: 'string', description: 'Load status of the sound file.', readonly: true },
      { name: 'volume', type: 'integer', description: 'Playback volume from 0–100.' },
    ],
    methods: [],
  },

  ComponentLibrary: {
    name: 'ComponentLibrary',
    extends: 'Node',
    description: 'Downloads and loads a remote SceneGraph component library at runtime.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/componentlibrary.md',
    fields: [
      { name: 'uri', type: 'uri', description: 'URL of the component library package.' },
      { name: 'loadStatus', type: 'string', description: 'Download status: "none", "loading", "ready", or "failed".', readonly: true },
    ],
    methods: [],
  },

  ChannelStore: {
    name: 'ChannelStore',
    extends: 'Node',
    description: 'Provides in-app purchasing and Roku account data via the Streaming Store API.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/channelstore.md',
    fields: [
      { name: 'command', type: 'string', description: 'Command to execute (e.g. "getUserData", "doOrder", "getPurchases").' },
      { name: 'requestedUserData', type: 'string', description: 'Comma-separated Roku account fields to request.' },
      { name: 'userData', type: 'node', description: 'Roku account data returned by getUserData.', readonly: true },
      { name: 'order', type: 'node', description: 'ContentNode tree defining items to purchase.' },
      { name: 'orderStatus', type: 'node', description: 'Result of a doOrder command.', readonly: true },
      { name: 'purchases', type: 'node', description: 'Results of a getPurchases command.', readonly: true },
      { name: 'catalog', type: 'node', description: 'Available in-app products from getCatalog.', readonly: true },
      { name: 'fakeServer', type: 'boolean', description: 'Enables test mode with local XML fixtures.' },
    ],
    methods: [],
  },

  // ── Widgets ───────────────────────────────────────────────────────────────

  Button: {
    name: 'Button',
    extends: 'Group',
    description: 'A simple button widget with text and optional icons.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/button.md',
    fields: [
      { name: 'text', type: 'string', description: 'Button label text.' },
      { name: 'textColor', type: 'string', description: 'Text color when not focused.' },
      { name: 'focusedTextColor', type: 'string', description: 'Text color when focused.' },
      { name: 'textFont', type: 'node', description: 'Font node for the label text.' },
      { name: 'focusedTextFont', type: 'node', description: 'Font node for focused label text.' },
      { name: 'showFocusFootprint', type: 'boolean', description: 'Show a footprint below the button when focused.' },
      { name: 'focusFootprintBitmapUri', type: 'uri', description: 'Image for the focus footprint.' },
      { name: 'focusedBitmapUri', type: 'uri', description: 'Background image when focused.' },
      { name: 'bitmapUri', type: 'uri', description: 'Background image when not focused.' },
      { name: 'minWidth', type: 'float', description: 'Minimum button width in pixels.' },
      { name: 'height', type: 'float', description: 'Button height in pixels.' },
      { name: 'maxWidth', type: 'float', description: 'Maximum button width in pixels.' },
    ],
    methods: [],
  },

  ButtonGroup: {
    name: 'ButtonGroup',
    extends: 'LayoutGroup',
    description: 'A LayoutGroup of Button nodes with shared styling.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/buttongroup.md',
    fields: [
      { name: 'buttons', type: 'array', description: 'Array of button label strings (creates Button children).' },
      { name: 'textColor', type: 'string', description: 'Label color for unfocused buttons.' },
      { name: 'focusedTextColor', type: 'string', description: 'Label color for the focused button.' },
      { name: 'textFont', type: 'node', description: 'Font for unfocused buttons.' },
      { name: 'focusedTextFont', type: 'node', description: 'Font for the focused button.' },
      { name: 'focusBitmapUri', type: 'uri', description: 'Background bitmap for the focused button.' },
      { name: 'focusFootprintBitmapUri', type: 'uri', description: 'Background bitmap shown as focus footprint.' },
      { name: 'iconUri', type: 'uri', description: 'Icon for unfocused buttons.' },
      { name: 'focusedIconUri', type: 'uri', description: 'Icon for the focused button.' },
      { name: 'minWidth', type: 'float', description: 'Minimum width for all buttons.' },
      { name: 'maxWidth', type: 'float', description: 'Maximum width for all buttons.' },
      { name: 'buttonHeight', type: 'float', description: 'Height of each button.' },
      { name: 'buttonSelected', type: 'integer', description: 'Index of the selected button.', readonly: true },
      { name: 'buttonFocused', type: 'integer', description: 'Index of the focused button.', readonly: true },
      { name: 'focusButton', type: 'integer', description: 'Moves focus to the specified button index.' },
    ],
    methods: [],
  },

  BusySpinner: {
    name: 'BusySpinner',
    extends: 'Group',
    description: 'An animated spinner indicating a loading or busy state.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/busyspinner.md',
    fields: [
      { name: 'poster', type: 'node', description: 'Internal Poster node; set its uri field to choose the spinner bitmap.' },
      { name: 'uri', type: 'uri', description: 'Alias for the internal Poster node uri field.' },
      { name: 'spinInterval', type: 'float', description: 'Number of seconds to complete one 360-degree rotation. Default 2.' },
      { name: 'clockwise', type: 'boolean', description: 'When true, the spinner rotates clockwise.' },
      { name: 'control', type: 'string', description: 'Write "start" to show and animate, "stop" to hide.' },
    ],
    methods: [],
  },

  ScrollableText: {
    name: 'ScrollableText',
    extends: 'Group',
    description: 'Displays long text with an automatic scrollbar.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/scrollabletext.md',
    fields: [
      { name: 'text', type: 'string', description: 'The text to display.' },
      { name: 'color', type: 'string', description: 'Text color.' },
      { name: 'font', type: 'node', description: 'Font node reference.' },
      { name: 'width', type: 'float', description: 'Total width including text area and scrollbar.' },
      { name: 'height', type: 'float', description: 'Height of the node.' },
      { name: 'lineSpacing', type: 'float', description: 'Additional space between lines.' },
      { name: 'horizAlign', type: 'string', description: '"left", "right", or "center".' },
      { name: 'vertAlign', type: 'string', description: '"top", "bottom", or "center".' },
      { name: 'scrollbarTrackBitmapUri', type: 'uri', description: 'Custom 9-patch image for the scrollbar track.' },
      { name: 'scrollbarThumbBitmapUri', type: 'uri', description: 'Custom 9-patch image for the scrollbar thumb.' },
    ],
    methods: [],
  },

  InfoPane: {
    name: 'InfoPane',
    extends: 'Group',
    description: 'A rounded rectangular pane displaying text and bullet points.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/infopane.md',
    fields: [
      { name: 'infoText', type: 'string', description: 'Primary text displayed in the pane.' },
      { name: 'width', type: 'integer', description: 'Width of the pane.' },
      { name: 'height', type: 'integer', description: 'Height of the pane.' },
      { name: 'textColor', type: 'string', description: 'Text color.' },
      { name: 'bulletText', type: 'array', description: 'List of strings displayed with bullet points.' },
      { name: 'infoText2', type: 'string', description: 'Second text string.' },
      { name: 'infoText2Color', type: 'string', description: 'Color of the second text.' },
      { name: 'infoText2BottomAlign', type: 'boolean', description: 'When true, aligns infoText2 to the bottom.' },
    ],
    methods: [],
  },

  // ── Timing and animation ──────────────────────────────────────────────────

  Timer: {
    name: 'Timer',
    extends: 'Node',
    description: 'Fires a callback after a delay. Can repeat.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/timer.md',
    fields: [
      { name: 'duration', type: 'float', description: 'Time in seconds before the timer fires.' },
      { name: 'repeat', type: 'boolean', description: 'When true, the timer restarts after firing.' },
      { name: 'control', type: 'string', description: 'Write "start" to begin, "stop" to cancel.' },
      { name: 'fire', type: 'boolean', description: 'Toggles each time the timer fires. Observe this field for the callback.', readonly: true },
    ],
    methods: [],
  },

  Task: {
    name: 'Task',
    extends: 'Node',
    description: 'Runs a function in a separate thread. Communicate with the main thread via shared fields.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/control-nodes/task.md',
    fields: [
      { name: 'functionName', type: 'string', description: 'Name of the function to execute in the task thread.' },
      { name: 'control', type: 'string', description: 'Write "RUN" to start the task, "STOP" to stop it.' },
      { name: 'state', type: 'string', description: '"init", "run", "stop", or "done". Read-only.', readonly: true },
    ],
    methods: [],
  },

  AnimationBase: {
    name: 'AnimationBase',
    extends: 'Node',
    description: 'Abstract base class for Animation, SequentialAnimation, and ParallelAnimation. Provides control, state, repeat, and delay fields.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/abstract-nodes/animationbase.md',
    fields: [
      { name: 'control', type: 'string', description: 'Write "start", "stop", "pause", "resume", or "finish".' },
      { name: 'state', type: 'string', description: '"stopped", "running", or "paused".', readonly: true },
      { name: 'repeat', type: 'boolean', description: 'When true, the animation loops.' },
      { name: 'delay', type: 'float', description: 'Delay in seconds before the animation starts.' },
    ],
    methods: [],
  },

  Animation: {
    name: 'Animation',
    extends: 'AnimationBase',
    description: 'Runs one or more interpolators to animate field values.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/animation.md',
    fields: [
      { name: 'duration', type: 'float', description: 'Total duration of the animation in seconds.' },
      { name: 'easeFunction', type: 'string', description: '"linear", "inQuad", "outQuad", "inOutQuad", "inCubic", "outCubic", "inOutCubic", "inExpo", "outExpo", "inOutExpo", etc.' },
      { name: 'optional', type: 'boolean', description: 'When true, the animation is skipped if the device is too busy.' },
    ],
    methods: [],
  },

  ParallelAnimation: {
    name: 'ParallelAnimation',
    extends: 'AnimationBase',
    description: 'Runs multiple child animations simultaneously.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/parallelanimation.md',
    fields: [
      { name: 'optional', type: 'boolean', description: 'When true, skip if device is busy.' },
    ],
    methods: [],
  },

  SequentialAnimation: {
    name: 'SequentialAnimation',
    extends: 'AnimationBase',
    description: 'Runs child animations one after another.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/sequentialanimation.md',
    fields: [
      { name: 'optional', type: 'boolean', description: 'When true, skip if device is busy.' },
    ],
    methods: [],
  },

  FloatFieldInterpolator: {
    name: 'FloatFieldInterpolator',
    extends: 'Node',
    description: 'Animates a float field between keyframe values.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/floatfieldinterpolator.md',
    fields: [
      { name: 'key', type: 'array', description: 'Array of keyframe times (0.0–1.0).' },
      { name: 'keyValue', type: 'array', description: 'Array of float values at each keyframe.' },
      { name: 'fieldToInterp', type: 'string', description: 'Field to animate in the form "nodeId.fieldName".' },
      { name: 'fraction', type: 'float', description: 'Current interpolation fraction (0.0–1.0).', readonly: true },
    ],
    methods: [],
  },

  Vector2DFieldInterpolator: {
    name: 'Vector2DFieldInterpolator',
    extends: 'Node',
    description: 'Animates a 2D vector field (e.g. translation or scale) between keyframe values.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/vector2dfieldinterpolator.md',
    fields: [
      { name: 'key', type: 'array', description: 'Array of keyframe times (0.0–1.0).' },
      { name: 'keyValue', type: 'array', description: 'Array of [x, y] values at each keyframe.' },
      { name: 'fieldToInterp', type: 'string', description: 'Field to animate in the form "nodeId.fieldName".' },
      { name: 'fraction', type: 'float', description: 'Current interpolation fraction.', readonly: true },
    ],
    methods: [],
  },

  ColorFieldInterpolator: {
    name: 'ColorFieldInterpolator',
    extends: 'Node',
    description: 'Animates a color field between keyframe values.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/colorfieldinterpolator.md',
    fields: [
      { name: 'key', type: 'array', description: 'Array of keyframe times (0.0–1.0).' },
      { name: 'keyValue', type: 'array', description: 'Array of hex color strings at each keyframe.' },
      { name: 'fieldToInterp', type: 'string', description: 'Field to animate in the form "nodeId.fieldName".' },
      { name: 'fraction', type: 'float', description: 'Current interpolation fraction.', readonly: true },
    ],
    methods: [],
  },

  // ── Content ───────────────────────────────────────────────────────────────

  ContentNode: {
    name: 'ContentNode',
    extends: 'Node',
    description: 'Node for storing content metadata (title, stream URLs, poster art, etc.).',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/contentnode.md',
    fields: [
      { name: 'title', type: 'string', description: 'Display title of the content.' },
      { name: 'description', type: 'string', description: 'Short description.' },
      { name: 'sdPosterUrl', type: 'uri', description: 'Standard-definition poster image URL.' },
      { name: 'hdPosterUrl', type: 'uri', description: 'High-definition poster image URL.' },
      { name: 'fullHdPosterUrl', type: 'uri', description: 'Full-HD poster image URL.' },
      { name: 'url', type: 'uri', description: 'Primary stream URL.' },
      { name: 'streamFormat', type: 'string', description: '"mp4", "hls", "ism", "dash", "smooth", or "none".' },
      { name: 'episodeNumber', type: 'integer', description: 'Episode number within a season.' },
      { name: 'seasonNumber', type: 'integer', description: 'Season number.' },
      { name: 'rating', type: 'string', description: 'Content rating string (e.g. "PG-13").' },
      { name: 'starRating', type: 'integer', description: 'Star rating (0–100).' },
      { name: 'length', type: 'integer', description: 'Duration in seconds.' },
      { name: 'live', type: 'boolean', description: 'True if the content is a live stream.' },
      { name: 'audioLanguage', type: 'string', description: 'Preferred audio language code (e.g. "eng").' },
      { name: 'subtitleLanguage', type: 'string', description: 'Preferred subtitle language code.' },
    ],
    methods: [],
  },

  // ── Scene ─────────────────────────────────────────────────────────────────

  Scene: {
    name: 'Scene',
    extends: 'Group',
    description: 'The root node of every SceneGraph application screen.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/scene.md',
    fields: [
      { name: 'backgroundColor', type: 'string', description: 'Background color behind the scene (hex RGBA string).' },
      { name: 'backgroundUri', type: 'uri', description: 'Background image URI.' },
      { name: 'dialog', type: 'node', description: 'A dialog node currently displayed over the scene.' },
      { name: 'currentDesignResolution', type: 'assocarray', description: 'The design resolution {width, height} chosen for this scene.', readonly: true },
      { name: 'backExitsScene', type: 'boolean', description: 'When true, pressing Back exits the scene.' },
      { name: 'exitChannel', type: 'boolean', description: 'Write true to exit the channel.' },
      { name: 'palette', type: 'node', description: 'RSGPalette node defining the default color palette for the scene.' },
      { name: 'allowBackgroundTask', type: 'boolean', description: 'When true, enables background task execution (Instant Resume apps).' },
      { name: 'limitBackgroundToUIResolution', type: 'boolean', description: 'When true, background images scale to the current UI resolution.' },
    ],
    methods: [],
  },

  // ── List / grid components ────────────────────────────────────────────────

  ArrayGrid: {
    name: 'ArrayGrid',
    extends: 'Group',
    description: 'Abstract base class providing functionality for list and grid nodes (LabelList, MarkupList, MarkupGrid, RowList).',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/abstract-nodes/arraygrid.md',
    fields: [
      { name: 'content', type: 'node', description: 'ContentNode tree supplying the list or grid items.' },
      { name: 'itemSize', type: 'array', description: '[width, height] of each item in pixels.' },
      { name: 'itemSpacing', type: 'array', description: '[x, y] spacing between items.' },
      { name: 'numRows', type: 'integer', description: 'Number of visible rows.' },
      { name: 'numColumns', type: 'integer', description: 'Number of columns (grids only).' },
      { name: 'focusRow', type: 'integer', description: 'Row index where focus is displayed.' },
      { name: 'focusColumn', type: 'integer', description: 'Column index for fixed focus (grids only).' },
      { name: 'horizFocusAnimationStyle', type: 'string', description: '"floatingFocus" or "fixedFocusWrap".' },
      { name: 'vertFocusAnimationStyle', type: 'string', description: '"floatingFocus", "fixedFocusWrap", or "fixedFocus".' },
      { name: 'drawFocusFeedback', type: 'boolean', description: 'When true, a focus indicator is drawn around the focused item.' },
      { name: 'drawFocusFeedbackOnTop', type: 'boolean', description: 'When true, the focus indicator renders above the item.' },
      { name: 'focusBitmapUri', type: 'uri', description: 'URI of the focus indicator image.' },
      { name: 'focusFootprintBitmapUri', type: 'uri', description: 'URI of the focus footprint image.' },
      { name: 'focusBitmapBlendColor', type: 'string', description: 'Blend color for the focus bitmap.' },
      { name: 'focusFootprintBlendColor', type: 'string', description: 'Blend color for the focus footprint bitmap.' },
      { name: 'animateToItem', type: 'integer', description: 'Write an index to animate to that item.' },
      { name: 'jumpToItem', type: 'integer', description: 'Write an index to jump immediately to that item.' },
      { name: 'itemFocused', type: 'integer', description: 'Index of the currently focused item.', readonly: true },
      { name: 'itemSelected', type: 'integer', description: 'Index of the most recently selected item.', readonly: true },
      { name: 'itemUnfocused', type: 'integer', description: 'Index of the most recently unfocused item.', readonly: true },
      { name: 'currFocusRow', type: 'float', description: 'Display row index of the focused item.', readonly: true },
      { name: 'currFocusColumn', type: 'float', description: 'Display column index of the focused item.', readonly: true },
      { name: 'wrap', type: 'boolean', description: 'When true, focus wraps from last to first item.' },
      { name: 'wrapDividerBitmapUri', type: 'uri', description: 'Visual divider bitmap when wrapping.' },
      { name: 'wrapDividerWidth', type: 'float', description: 'Width of the wrap divider.' },
      { name: 'wrapDividerHeight', type: 'float', description: 'Height of the wrap divider.' },
      { name: 'fixedLayout', type: 'boolean', description: 'When true, items have varied widths from ContentNode.' },
      { name: 'numRenderPasses', type: 'integer', description: 'Number of rendering passes for complex items.' },
      { name: 'rowHeights', type: 'array', description: 'Array of per-row heights overriding itemSize.' },
      { name: 'columnWidths', type: 'array', description: 'Array of per-column widths overriding itemSize.' },
      { name: 'columnSpacings', type: 'array', description: 'Array of per-column spacings overriding itemSpacing.' },
      { name: 'sectionDividerHeight', type: 'float', description: 'Height of section dividers.' },
      { name: 'sectionDividerFont', type: 'node', description: 'Font node for section divider text.' },
      { name: 'sectionDividerTextColor', type: 'string', description: 'Text color of section dividers.' },
    ],
    methods: [],
  },

  LabelList: {
    name: 'LabelList',
    extends: 'ArrayGrid',
    description: 'A vertically-scrolling list of text items.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/labellist.md',
    fields: [
      { name: 'textFont', type: 'node', description: 'Font node for item labels.' },
      { name: 'focusedTextFont', type: 'node', description: 'Font node for the focused item label.' },
      { name: 'color', type: 'string', description: 'Text color for non-focused items.' },
      { name: 'focusedColor', type: 'string', description: 'Text color for the focused item.' },
    ],
    methods: [],
  },

  CheckList: {
    name: 'CheckList',
    extends: 'LabelList',
    description: 'A LabelList with checkbox icons for each item.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/checklist.md',
    fields: [
      { name: 'checkedState', type: 'array', description: 'Per-item checked/unchecked boolean state.' },
      { name: 'checkOnSelect', type: 'boolean', description: 'When true, pressing OK toggles the checked state.' },
      { name: 'checkedIconUri', type: 'uri', description: 'Custom checked icon for unfocused items.' },
      { name: 'uncheckedIconUri', type: 'uri', description: 'Custom unchecked icon for unfocused items.' },
      { name: 'focusedCheckedIconUri', type: 'uri', description: 'Custom checked icon for the focused item.' },
      { name: 'focusedUncheckedIconUri', type: 'uri', description: 'Custom unchecked icon for the focused item.' },
    ],
    methods: [],
  },

  MarkupList: {
    name: 'MarkupList',
    extends: 'ArrayGrid',
    description: 'A list that renders each item using a custom component.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/markuplist.md',
    fields: [
      { name: 'itemComponentName', type: 'string', description: 'Name of the SceneGraph component to use for each row.' },
    ],
    methods: [],
  },

  MarkupGrid: {
    name: 'MarkupGrid',
    extends: 'ArrayGrid',
    description: 'A grid that renders each cell using a custom component.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/markupgrid.md',
    fields: [
      { name: 'itemComponentName', type: 'string', description: 'Name of the SceneGraph component to use for each cell.' },
    ],
    methods: [],
  },

  PosterGrid: {
    name: 'PosterGrid',
    extends: 'ArrayGrid',
    description: 'A grid of poster images with optional captions and section dividers.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/list-and-grid-nodes/postergrid.md',
    fields: [
      { name: 'basePosterSize', type: 'array', description: 'Default [width, height] for poster items.' },
      { name: 'posterDisplayMode', type: 'string', description: 'Image scaling mode: "noScale", "scaleToFit", "scaleToFill", or "scaleToZoom".' },
      { name: 'loadingBitmapUri', type: 'uri', description: 'Bitmap shown while a poster loads.' },
      { name: 'failedBitmapUri', type: 'uri', description: 'Bitmap shown when a poster fails to load.' },
      { name: 'imageWellBitmapUri', type: 'uri', description: 'Placeholder bitmap for empty cells.' },
      { name: 'caption1Font', type: 'node', description: 'Font for the first caption line.' },
      { name: 'caption1Color', type: 'string', description: 'Color for the first caption line.' },
      { name: 'caption1NumLines', type: 'integer', description: 'Max lines for caption 1.' },
      { name: 'caption2Font', type: 'node', description: 'Font for the second caption line.' },
      { name: 'caption2Color', type: 'string', description: 'Color for the second caption line.' },
      { name: 'caption2NumLines', type: 'integer', description: 'Max lines for caption 2.' },
    ],
    methods: [],
  },

  RowList: {
    name: 'RowList',
    extends: 'ArrayGrid',
    description: 'A vertically-scrolling list of rows, where each row is a horizontal scrolling list.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/list-and-grid-nodes/rowlist.md',
    fields: [
      { name: 'itemComponentName', type: 'string', description: 'Default item component name used for all rows.' },
      { name: 'rowTitleComponentName', type: 'string', description: 'Component used to render row title labels; must extend Group.' },
      { name: 'rowHeights', type: 'array', description: 'Array of individual row heights in pixels.' },
      { name: 'rowSpacings', type: 'array', description: 'Array of vertical spacing values after each row.' },
      { name: 'rowItemSize', type: 'array', description: 'Array of [width, height] per-row item sizes.' },
      { name: 'rowItemSpacing', type: 'array', description: 'Array of [x, y] horizontal spacing between items per row.' },
      { name: 'focusXOffset', type: 'array', description: 'X offset for the first visible item in each row.' },
      { name: 'rowLabelOffset', type: 'array', description: 'Position offset for row labels per row.' },
      { name: 'showRowLabel', type: 'array', description: 'Controls row label visibility per row.' },
      { name: 'showRowCounter', type: 'array', description: 'Controls row item-count label visibility per row.' },
      { name: 'indefiniteRowItemCount', type: 'array', description: 'When true for a row, appends "+" to its item count.' },
      { name: 'variableWidthItems', type: 'array', description: 'When true for a row, items may have different widths.' },
      { name: 'rowFocusAnimationStyle', type: 'string', description: '"floatingFocus", "fixedFocusWrap", or "fixedFocus" — horizontal focus movement within a row.' },
      { name: 'rowLabelColor', type: 'string', description: 'Color for row title labels.' },
      { name: 'rowLabelFont', type: 'node', description: 'Font node for row title labels.' },
      { name: 'rowCounterRightOffset', type: 'float', description: 'Right-edge position of the row item counter.' },
      { name: 'showRowCounterForShortRows', type: 'boolean', description: 'When true, shows the item counter even for rows that fit entirely on screen.' },
      { name: 'imageWellBitmapUri', type: 'uri', description: 'Bitmap shown behind empty list slots.' },
      { name: 'loadingBitmapUri', type: 'uri', description: 'Bitmap shown while items are loading.' },
      { name: 'loadingBitmapOpacity', type: 'float', description: 'Opacity of the loading bitmap.' },
      { name: 'failedBitmapUri', type: 'uri', description: 'Bitmap shown when items fail to load.' },
      { name: 'failedBitmapOpacity', type: 'float', description: 'Opacity of the failed bitmap.' },
      { name: 'wrapDividerBitmapUri', type: 'uri', description: 'Visual divider bitmap between wrapped items.' },
      { name: 'wrapDividerHeight', type: 'float', description: 'Height of the wrap divider in pixels.' },
      { name: 'currFocusColumn', type: 'float', description: 'Column index that currently has focus within a row.' },
      { name: 'rowFocused', type: 'integer', description: 'Index of the currently focused row.', readonly: true },
      { name: 'rowItemFocused', type: 'array', description: '[rowIndex, itemIndex] of the focused item.', readonly: true },
      { name: 'rowItemSelected', type: 'array', description: '[rowIndex, itemIndex] of the last selected item.', readonly: true },
      { name: 'jumpToRow', type: 'integer', description: 'Write a row index to jump immediately to that row.' },
      { name: 'jumpToRowItem', type: 'array', description: 'Write [rowIndex, itemIndex] to jump immediately to that item.' },
      { name: 'animateToRow', type: 'integer', description: 'Write a row index to animate-scroll to that row.' },
      { name: 'animateToRowItem', type: 'array', description: 'Write [rowIndex, itemIndex] to animate-scroll to that item.' },
    ],
    methods: [],
  },

  TimeGrid: {
    name: 'TimeGrid',
    extends: 'Group',
    description: 'An electronic program guide (EPG) grid showing programs by channel and time.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/timegrid.md',
    fields: [
      { name: 'content', type: 'node', description: 'Root ContentNode with one child per channel.' },
      { name: 'maxDays', type: 'integer', description: 'Scrollable width in days.' },
      { name: 'duration', type: 'float', description: 'Visible time window in seconds.' },
      { name: 'channelInfoComponentName', type: 'string', description: 'Component for channel info cells.' },
      { name: 'channelInfoWidth', type: 'float', description: 'Width of the channel info column.' },
      { name: 'channelInfoFocusable', type: 'boolean', description: 'Whether the channel info column is focusable.' },
      { name: 'focusBitmapUri', type: 'uri', description: 'Focus indicator bitmap.' },
      { name: 'programTitleColor', type: 'string', description: 'Text color for unfocused program titles.' },
      { name: 'programTitleFocusedColor', type: 'string', description: 'Text color for the focused program title.' },
      { name: 'programTitleFont', type: 'node', description: 'Font for program titles.' },
      { name: 'channelSelected', type: 'integer', description: 'Index of the selected channel.', readonly: true },
      { name: 'channelFocused', type: 'integer', description: 'Index of the focused channel.', readonly: true },
      { name: 'programSelected', type: 'integer', description: 'Index of the selected program.', readonly: true },
      { name: 'programFocused', type: 'integer', description: 'Index of the focused program.', readonly: true },
      { name: 'animateToChannel', type: 'integer', description: 'Animate to a channel row.' },
      { name: 'jumpToChannel', type: 'integer', description: 'Jump to a channel row.' },
      { name: 'nowNextMode', type: 'boolean', description: 'When true, shows only Now and Next columns.' },
      { name: 'showPastTimeScreen', type: 'boolean', description: 'When true, tints past-time programs.' },
      { name: 'timeBarHeight', type: 'float', description: 'Height of the time label bar.' },
    ],
    methods: [],
  },

  ZoomRowList: {
    name: 'ZoomRowList',
    extends: 'Group',
    description: 'A vertically-scrolling list of rows where the focused row zooms to a larger size.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/zoomrowlist.md',
    fields: [
      { name: 'content', type: 'node', description: 'Root ContentNode with one child per row.' },
      { name: 'itemComponentName', type: 'string', description: 'Component used to render each item.' },
      { name: 'rowWidth', type: 'float', description: 'Maximum safe row width.' },
      { name: 'rowHeight', type: 'array', description: 'Height of each ZoomRowItem when unfocused.' },
      { name: 'rowZoomHeight', type: 'array', description: 'Height of each ZoomRowItem when focused.' },
      { name: 'spacingAfterRow', type: 'float', description: 'Vertical spacing between rows.' },
      { name: 'rowItemHeight', type: 'array', description: 'Height of each item when unfocused.' },
      { name: 'rowItemZoomHeight', type: 'array', description: 'Height of each item when focused.' },
      { name: 'rowItemAspectRatio', type: 'array', description: 'Width-to-height aspect ratio for items.' },
      { name: 'spacingAfterRowItem', type: 'array', description: 'Horizontal spacing between items.' },
      { name: 'wrap', type: 'boolean', description: 'When true, rows wrap from bottom to top.' },
      { name: 'drawFocusFeedback', type: 'boolean', description: 'When true, a focus indicator is drawn.' },
      { name: 'drawFocusFeedbackOnTop', type: 'boolean', description: 'When true, focus indicator renders above items.' },
      { name: 'focusBitmapUri', type: 'uri', description: 'Focus indicator bitmap.' },
      { name: 'focusBitmapBlendColor', type: 'string', description: 'Tint for the focus bitmap.' },
      { name: 'showRowTitle', type: 'array', description: 'Whether the row title label is shown per row.' },
      { name: 'showRowCounter', type: 'array', description: 'Whether the row counter is shown per row.' },
      { name: 'rowSelected', type: 'integer', description: 'Index of the selected row.', readonly: true },
      { name: 'rowFocused', type: 'integer', description: 'Index of the focused row.', readonly: true },
      { name: 'rowItemSelected', type: 'array', description: '[rowIndex, itemIndex] of the selected item.', readonly: true },
      { name: 'rowItemFocused', type: 'array', description: '[rowIndex, itemIndex] of the focused item.', readonly: true },
      { name: 'currFocusRow', type: 'float', description: 'Floating-point row index during animation.', readonly: true },
      { name: 'jumpToRow', type: 'integer', description: 'Jump to a row.' },
      { name: 'animateToRow', type: 'integer', description: 'Animate to a row.' },
    ],
    methods: [],
  },

  // ── Text input ────────────────────────────────────────────────────────────

  TextEditBox: {
    name: 'TextEditBox',
    extends: 'Group',
    description: 'A single-line text input field.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/texteditbox.md',
    fields: [
      { name: 'text', type: 'string', description: 'Current text content.' },
      { name: 'hintText', type: 'string', description: 'Placeholder text shown when empty.' },
      { name: 'maxChars', type: 'integer', description: 'Maximum number of characters.' },
      { name: 'secureMode', type: 'boolean', description: 'When true, characters are masked.' },
      { name: 'width', type: 'float', description: 'Width of the edit box in pixels.' },
      { name: 'textColor', type: 'string', description: 'Text color.' },
      { name: 'hintTextColor', type: 'string', description: 'Hint text color.' },
      { name: 'cursorColor', type: 'string', description: 'Cursor color.' },
      { name: 'backgroundUri', type: 'uri', description: 'Background image URI.' },
      { name: 'focusedBackgroundUri', type: 'uri', description: 'Background image when focused.' },
    ],
    methods: [],
  },

  // ── Keyboard nodes ────────────────────────────────────────────────────────

  DynamicKeyboardBase: {
    name: 'DynamicKeyboardBase',
    extends: 'Group',
    description: 'Abstract base class for dynamic voice-enabled keyboards (DynamicKeyboard, DynamicPinPad, DynamicMiniKeyboard).',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/abstract-nodes/dynamickeyboardbase.md',
    fields: [
      { name: 'text', type: 'string', description: 'The text that has been entered.' },
      { name: 'textEditBox', type: 'node', description: 'The internal VoiceTextEditBox node.', readonly: true },
      { name: 'hideTextBox', type: 'boolean', description: 'Hides the internal VoiceTextEditBox.' },
      { name: 'keyGrid', type: 'node', description: 'The internal DynamicKeyGrid node.', readonly: true },
    ],
    methods: [],
  },

  Keyboard: {
    name: 'Keyboard',
    extends: 'Group',
    description: 'A full on-screen keyboard widget.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/keyboard.md',
    fields: [
      { name: 'text', type: 'string', description: 'Current text entered.' },
      { name: 'showTextBox', type: 'boolean', description: 'When true, a TextEditBox is shown above the keyboard.' },
      { name: 'textEditBox', type: 'node', description: 'The embedded TextEditBox node.', readonly: true },
      { name: 'keyboardBitmapUri', type: 'uri', description: 'Custom keyboard background image.' },
    ],
    methods: [],
  },

  MiniKeyboard: {
    name: 'MiniKeyboard',
    extends: 'Group',
    description: 'A compact on-screen keyboard.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/minikeyboard.md',
    fields: [
      { name: 'text', type: 'string', description: 'Current text entered.' },
      { name: 'showTextBox', type: 'boolean', description: 'When true, a TextEditBox is shown above the keyboard.' },
      { name: 'textEditBox', type: 'node', description: 'The embedded TextEditBox node.', readonly: true },
    ],
    methods: [],
  },

  PinPad: {
    name: 'PinPad',
    extends: 'Group',
    description: 'A numeric PIN entry pad.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/pinpad.md',
    fields: [
      { name: 'text', type: 'string', description: 'The PIN entered so far.' },
      { name: 'secureMode', type: 'boolean', description: 'When true, entered digits are masked.' },
      { name: 'showTextBox', type: 'boolean', description: 'When true, a TextEditBox shows the PIN.' },
      { name: 'textEditBox', type: 'node', description: 'The embedded TextEditBox node.', readonly: true },
      { name: 'maxLength', type: 'integer', description: 'Maximum PIN length.' },
    ],
    methods: [],
  },

  // ── Dynamic voice keyboards ────────────────────────────────────────────────

  DynamicKeyboard: {
    name: 'DynamicKeyboard',
    extends: 'DynamicKeyboardBase',
    description: 'A full dynamic alphanumeric keyboard with voice entry support.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/control-nodes/dynamickeyboard.md',
    fields: [
      { name: 'voiceEntryType', type: 'string', description: 'Type of voice entry allowed.' },
      { name: 'voiceEnabled', type: 'boolean', description: 'Whether voice entry is enabled.' },
      { name: 'maxTextLength', type: 'integer', description: 'Maximum length of entered text.' },
    ],
    methods: [],
  },

  DynamicPinPad: {
    name: 'DynamicPinPad',
    extends: 'DynamicKeyboardBase',
    description: 'A dynamic numeric PIN pad with voice entry support.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/control-nodes/dynamicpinpad.md',
    fields: [
      { name: 'voiceEntryType', type: 'string', description: 'Type of voice entry allowed.' },
      { name: 'voiceEnabled', type: 'boolean', description: 'Whether voice entry is enabled.' },
      { name: 'maxTextLength', type: 'integer', description: 'Maximum length of entered text.' },
    ],
    methods: [],
  },

  DynamicMiniKeyboard: {
    name: 'DynamicMiniKeyboard',
    extends: 'DynamicKeyboardBase',
    description: 'A compact dynamic keyboard with voice entry support.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/control-nodes/dynamicminikeyboard.md',
    fields: [
      { name: 'voiceEntryType', type: 'string', description: 'Type of voice entry allowed.' },
      { name: 'voiceEnabled', type: 'boolean', description: 'Whether voice entry is enabled.' },
      { name: 'maxTextLength', type: 'integer', description: 'Maximum length of entered text.' },
    ],
    methods: [],
  },

  DynamicCustomKeyboard: {
    name: 'DynamicCustomKeyboard',
    extends: 'DynamicKeyboardBase',
    description: 'A dynamic keyboard with a developer-defined key layout from a Key Definition File.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/control-nodes/dynamiccustomkeyboard.md',
    fields: [
      { name: 'voiceEntryType', type: 'string', description: 'Type of voice entry allowed.' },
      { name: 'voiceEnabled', type: 'boolean', description: 'Whether voice entry is enabled.' },
      { name: 'maxTextLength', type: 'integer', description: 'Maximum length of entered text.' },
    ],
    methods: [],
  },

  DynamicKeyGrid: {
    name: 'DynamicKeyGrid',
    extends: 'Group',
    description: 'The grid of keys rendered inside dynamic keyboards, laid out from a JSON Key Definition File.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/control-nodes/dynamickeygrid.md',
    fields: [
      { name: 'keyDefinitionUri', type: 'uri', description: 'URI of the JSON Key Definition File.' },
      { name: 'mode', type: 'string', description: 'Current keyboard mode.' },
      { name: 'focusVisible', type: 'boolean', description: 'Whether the key focus indicator is visible.' },
      { name: 'horizWrap', type: 'boolean', description: 'Whether horizontal navigation wraps around.' },
      { name: 'vertWrap', type: 'boolean', description: 'Whether vertical navigation wraps around.' },
      { name: 'palette', type: 'node', description: 'Color palette node for key styling.' },
      { name: 'keyFocused', type: 'string', description: 'The currently focused key.', readonly: true },
      { name: 'keySelected', type: 'string', description: 'The last selected key.', readonly: true },
    ],
    methods: [],
  },

  VoiceTextEditBox: {
    name: 'VoiceTextEditBox',
    extends: 'TextEditBox',
    description: 'A text edit box with voice entry support, showing a mic icon and voice hint.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/control-nodes/voicetexteditbox.md',
    fields: [
      { name: 'voiceEnabled', type: 'boolean', description: 'Whether voice entry is enabled.' },
      { name: 'voiceEntryType', type: 'string', description: 'Type of voice entry allowed.' },
      { name: 'isDictating', type: 'boolean', description: 'Whether the user is currently dictating.', readonly: true },
    ],
    methods: [],
  },

  // ── Legacy dialogs ─────────────────────────────────────────────────────────

  Dialog: {
    name: 'Dialog',
    extends: 'Group',
    description: 'Legacy modal dialog with title, message, bullet text, graphic, and buttons.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/control-nodes/dialog.md',
    fields: [
      { name: 'title', type: 'string', description: 'Dialog title.' },
      { name: 'message', type: 'string', description: 'Dialog message text.' },
      { name: 'bulletText', type: 'array', description: 'Array of bullet text strings.' },
      { name: 'buttons', type: 'array', description: 'Array of button label strings.' },
      { name: 'buttonGroup', type: 'node', description: 'The internal ButtonGroup node.' },
      { name: 'graphicUri', type: 'uri', description: 'URI of the dialog graphic.' },
      { name: 'graphicWidth', type: 'float', description: 'Width of the dialog graphic.' },
      { name: 'graphicHeight', type: 'float', description: 'Height of the dialog graphic.' },
      { name: 'buttonSelected', type: 'integer', description: 'Index of the selected button.', readonly: true },
      { name: 'buttonFocused', type: 'integer', description: 'Index of the focused button.', readonly: true },
      { name: 'backgroundUri', type: 'uri', description: 'Background image URI.' },
      { name: 'iconUri', type: 'uri', description: 'Icon image URI.' },
      { name: 'optionsDialog', type: 'boolean', description: 'When true, the dialog is styled as an options dialog.' },
      { name: 'close', type: 'boolean', description: 'Set to true to close the dialog.' },
      { name: 'wasClosed', type: 'boolean', description: 'True when the dialog was dismissed.', readonly: true },
      { name: 'width', type: 'float', description: 'Dialog width in pixels.' },
    ],
    methods: [],
  },

  KeyboardDialog: {
    name: 'KeyboardDialog',
    extends: 'Dialog',
    description: 'A legacy dialog with an embedded Keyboard for text entry.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/control-nodes/keyboarddialog.md',
    fields: [
      { name: 'text', type: 'string', description: 'The text entered in the keyboard.' },
      { name: 'keyboard', type: 'node', description: 'The embedded Keyboard node.', readonly: true },
    ],
    methods: [],
  },

  PinDialog: {
    name: 'PinDialog',
    extends: 'Dialog',
    description: 'A legacy dialog with an embedded PinPad for numeric entry.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/control-nodes/pindialog.md',
    fields: [
      { name: 'pin', type: 'string', description: 'The PIN entered.' },
      { name: 'pinPad', type: 'node', description: 'The embedded PinPad node.', readonly: true },
      { name: 'pinPadFocused', type: 'boolean', description: 'Whether the PinPad has focus.' },
    ],
    methods: [],
  },

  ProgressDialog: {
    name: 'ProgressDialog',
    extends: 'Dialog',
    description: 'A legacy dialog displaying a spinning progress indicator.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/control-nodes/progressdialog.md',
    fields: [],
    methods: [],
  },

  // ── Panels & overhang ─────────────────────────────────────────────────────

  Panel: {
    name: 'Panel',
    extends: 'Group',
    description: 'A panel in a PanelSet layout with slide transitions.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/panel.md',
    fields: [
      { name: 'panelSize', type: 'string', description: 'Named size: "narrow", "medium", "wide", or "full".' },
      { name: 'width', type: 'float', description: 'Width in pixels.' },
      { name: 'height', type: 'float', description: 'Height in pixels.' },
      { name: 'leftPosition', type: 'float', description: 'Horizontal position relative to PanelSet left edge.' },
      { name: 'overhangTitle', type: 'string', description: 'Text shown in the overhang when this panel is left.' },
      { name: 'optionsAvailable', type: 'boolean', description: 'Enables the options button.' },
      { name: 'hasNextPanel', type: 'boolean', description: 'When true, allows focus to move right.' },
      { name: 'isFullScreen', type: 'boolean', description: 'When true, occupies both positions.' },
      { name: 'selectButtonMovesPanelForward', type: 'boolean', description: 'When true, OK moves to next panel.' },
    ],
    methods: [],
  },

  PanelSet: {
    name: 'PanelSet',
    extends: 'Group',
    description: 'Manages slide transitions between Panel child nodes.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/panelset.md',
    fields: [
      { name: 'width', type: 'float', description: 'Width of the PanelSet.' },
      { name: 'height', type: 'float', description: 'Height of the PanelSet.' },
      { name: 'slideDuration', type: 'integer', description: 'Transition duration in milliseconds.' },
      { name: 'numPanels', type: 'integer', description: 'Current number of Panel children.', readonly: true },
      { name: 'isGoingBack', type: 'boolean', description: 'True when panels are sliding backward.', readonly: true },
    ],
    methods: [],
  },

  Overhang: {
    name: 'Overhang',
    extends: 'Group',
    description: 'A top-of-screen bar displaying logo, title, clock, and options indicator.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/overhang.md',
    fields: [
      { name: 'title', type: 'string', description: 'Text displayed on the left side.' },
      { name: 'logoUri', type: 'uri', description: 'Logo bitmap URI.' },
      { name: 'showClock', type: 'boolean', description: 'Whether the clock is shown.' },
      { name: 'showOptions', type: 'boolean', description: 'Whether the options prompt is shown.' },
      { name: 'optionsAvailable', type: 'boolean', description: 'Whether the options key is functional.' },
      { name: 'color', type: 'string', description: 'Solid background color.' },
      { name: 'backgroundUri', type: 'uri', description: 'Background image URI.' },
      { name: 'titleColor', type: 'string', description: 'Title text color.' },
      { name: 'clockColor', type: 'string', description: 'Clock text color.' },
      { name: 'clockText', type: 'string', description: 'Custom text replacing the clock.' },
      { name: 'optionsColor', type: 'string', description: 'Options indicator color when available.' },
      { name: 'height', type: 'float', description: 'Height of the overhang region.' },
    ],
    methods: [],
  },

  OverhangPanelSetScene: {
    name: 'OverhangPanelSetScene',
    extends: 'Scene',
    description: 'A Scene with a pre-built Overhang and PanelSet.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/overhangpanelsetscene.md',
    fields: [
      { name: 'overhang', type: 'node', description: 'The pre-built Overhang node.', readonly: true },
      { name: 'panelSet', type: 'node', description: 'The pre-built PanelSet node.', readonly: true },
    ],
    methods: [],
  },

  ListPanel: {
    name: 'ListPanel',
    extends: 'Panel',
    description: 'A Panel configured to display a LabelList or MarkupList.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/listpanel.md',
    fields: [
      { name: 'list', type: 'node', description: 'The list node to display.' },
      { name: 'leftLabel', type: 'node', description: 'Label above the top-left corner.' },
      { name: 'rightLabel', type: 'node', description: 'Label above the top-right corner.' },
      { name: 'showSectionLabels', type: 'boolean', description: 'When true, shows current section title.' },
      { name: 'createNextPanelIndex', type: 'integer', description: 'Focused item index when a new panel is needed.', readonly: true },
      { name: 'nextPanel', type: 'node', description: 'The panel to add to the right.' },
      { name: 'createNextPanelOnItemFocus', type: 'boolean', description: 'Enables auto create-next-panel on focus change.' },
    ],
    methods: [],
  },

  GridPanel: {
    name: 'GridPanel',
    extends: 'Panel',
    description: 'A Panel configured to display a PosterGrid or MarkupGrid.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/gridpanel.md',
    fields: [
      { name: 'grid', type: 'node', description: 'The grid node to display.' },
      { name: 'leftLabel', type: 'node', description: 'Label above the top-left corner.' },
      { name: 'rightLabel', type: 'node', description: 'Label above the top-right corner.' },
      { name: 'showSectionLabels', type: 'boolean', description: 'When true, shows current section title.' },
      { name: 'createNextPanelIndex', type: 'integer', description: 'Focused item index when a new panel is needed.', readonly: true },
      { name: 'nextPanel', type: 'node', description: 'The panel to add to the right.' },
      { name: 'createNextPanelOnItemFocus', type: 'boolean', description: 'Enables auto create-next-panel on focus change.' },
    ],
    methods: [],
  },

  // ── Standard dialog framework ────────────────────────────────────────────

  StandardDialog: {
    name: 'StandardDialog',
    extends: 'Group',
    description: 'Base class for standard modal dialogs with title, content, and button areas.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/control-nodes/standarddialog.md',
    fields: [
      { name: 'width', type: 'float', description: 'Dialog width in pixels.' },
      { name: 'height', type: 'float', description: 'Dialog height in pixels.' },
      { name: 'buttonSelected', type: 'integer', description: 'Index of the selected button.', readonly: true },
      { name: 'buttonFocused', type: 'integer', description: 'Index of the focused button.', readonly: true },
      { name: 'palette', type: 'node', description: 'Color palette node for dialog styling.' },
      { name: 'close', type: 'boolean', description: 'Set to true to close the dialog.' },
      { name: 'wasClosed', type: 'boolean', description: 'True when the dialog was dismissed.', readonly: true },
    ],
    methods: [],
  },

  StandardMessageDialog: {
    name: 'StandardMessageDialog',
    extends: 'StandardDialog',
    description: 'A system-style modal dialog with a title, message, and buttons.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/standardmessagedialog.md',
    fields: [
      { name: 'title', type: 'string', description: 'Dialog title.' },
      { name: 'message', type: 'string', description: 'Dialog message body.' },
      { name: 'buttons', type: 'array', description: 'Array of button label strings.' },
    ],
    methods: [],
  },

  StandardProgressDialog: {
    name: 'StandardProgressDialog',
    extends: 'StandardDialog',
    description: 'A system-style modal dialog with a progress spinner.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/standardprogressdialog.md',
    fields: [
      { name: 'title', type: 'string', description: 'Dialog title.' },
      { name: 'message', type: 'string', description: 'Dialog message body.' },
    ],
    methods: [],
  },

  StandardKeyboardDialog: {
    name: 'StandardKeyboardDialog',
    extends: 'StandardDialog',
    description: 'A standard dialog with an embedded dynamic keyboard for text entry.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/control-nodes/standardkeyboarddialog.md',
    fields: [
      { name: 'title', type: 'string', description: 'Dialog title.' },
      { name: 'message', type: 'array', description: 'Array of message strings.' },
      { name: 'buttons', type: 'array', description: 'Array of button label strings.' },
      { name: 'text', type: 'string', description: 'The text entered in the keyboard.' },
      { name: 'textEditBox', type: 'node', description: 'The embedded text edit box node.', readonly: true },
      { name: 'keyboardDomain', type: 'string', description: 'Domain hint for the keyboard layout.' },
    ],
    methods: [],
  },

  StandardPinPadDialog: {
    name: 'StandardPinPadDialog',
    extends: 'StandardDialog',
    description: 'A standard dialog with an embedded dynamic PIN pad.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/control-nodes/standardpinpaddialog.md',
    fields: [
      { name: 'title', type: 'string', description: 'Dialog title.' },
      { name: 'message', type: 'array', description: 'Array of message strings.' },
      { name: 'buttons', type: 'array', description: 'Array of button label strings.' },
      { name: 'pin', type: 'string', description: 'The PIN entered.' },
      { name: 'textEditBox', type: 'node', description: 'The embedded text edit box node.', readonly: true },
    ],
    methods: [],
  },

  StdDlgAreaBase: {
    name: 'StdDlgAreaBase',
    extends: 'Group',
    description: 'Abstract base for dialog area nodes (title, content, button, side card).',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/control-nodes/stddlgareabase.md',
    fields: [],
    methods: [],
  },

  StdDlgTitleArea: {
    name: 'StdDlgTitleArea',
    extends: 'StdDlgAreaBase',
    description: 'Title area at the top of a custom StandardDialog.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/control-nodes/stddlgtitlearea.md',
    fields: [
      { name: 'primaryTitle', type: 'string', description: 'The primary title text.' },
    ],
    methods: [],
  },

  StdDlgContentArea: {
    name: 'StdDlgContentArea',
    extends: 'StdDlgAreaBase',
    description: 'Content area container for StdDlgItemBase children in a custom StandardDialog.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/control-nodes/stddlgcontentarea.md',
    fields: [],
    methods: [],
  },

  StdDlgButtonArea: {
    name: 'StdDlgButtonArea',
    extends: 'StdDlgAreaBase',
    description: 'Button area container for StdDlgButton children in a custom StandardDialog.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/control-nodes/stddlgbuttonarea.md',
    fields: [],
    methods: [],
  },

  StdDlgSideCardArea: {
    name: 'StdDlgSideCardArea',
    extends: 'StdDlgAreaBase',
    description: 'A freeform side card area to the left or right of a custom StandardDialog.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/control-nodes/stddlgsidecardarea.md',
    fields: [
      { name: 'horizAlign', type: 'string', description: 'Horizontal alignment of the side card.' },
      { name: 'showDivider', type: 'boolean', description: 'Whether to show a divider between the side card and dialog.' },
      { name: 'width', type: 'float', description: 'Width of the side card area.' },
      { name: 'extendToDialogEdge', type: 'boolean', description: 'Whether the side card extends to the dialog edge.' },
    ],
    methods: [],
  },

  StdDlgItemBase: {
    name: 'StdDlgItemBase',
    extends: 'Group',
    description: 'Abstract base for content items inside a StdDlgContentArea.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/control-nodes/stddlgitembase.md',
    fields: [],
    methods: [],
  },

  StdDlgTextItem: {
    name: 'StdDlgTextItem',
    extends: 'StdDlgItemBase',
    description: 'A text block content item for a StandardDialog content area.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/control-nodes/stddlgtextitem.md',
    fields: [
      { name: 'text', type: 'string', description: 'The text content.' },
      { name: 'namedTextStyle', type: 'string', description: 'Named text style to apply.' },
    ],
    methods: [],
  },

  StdDlgMultiStyleTextItem: {
    name: 'StdDlgMultiStyleTextItem',
    extends: 'StdDlgItemBase',
    description: 'A rich text content item with markup tags and named drawing styles.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/control-nodes/stddlgmultistyletextitem.md',
    fields: [
      { name: 'text', type: 'string', description: 'The rich text content with markup tags.' },
      { name: 'drawingStyles', type: 'assocarray', description: 'Named drawing styles for markup tags.' },
    ],
    methods: [],
  },

  StdDlgBulletTextItem: {
    name: 'StdDlgBulletTextItem',
    extends: 'StdDlgItemBase',
    description: 'A bulleted or numbered list content item.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/control-nodes/stddlgbullettextitem.md',
    fields: [
      { name: 'bulletText', type: 'array', description: 'Array of bullet text strings.' },
      { name: 'bulletType', type: 'string', description: 'Bullet type: "bullet" or "numbered".' },
    ],
    methods: [],
  },

  StdDlgKeyboardItem: {
    name: 'StdDlgKeyboardItem',
    extends: 'StdDlgItemBase',
    description: 'An embedded keyboard content item for dialog text entry.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/control-nodes/stddlgkeyboarditem.md',
    fields: [
      { name: 'keyLayout', type: 'string', description: 'Keyboard layout to use.' },
      { name: 'text', type: 'string', description: 'The text entered in the keyboard.' },
      { name: 'textEditBox', type: 'node', description: 'The embedded text edit box node.', readonly: true },
    ],
    methods: [],
  },

  StdDlgProgressItem: {
    name: 'StdDlgProgressItem',
    extends: 'StdDlgItemBase',
    description: 'A spinning progress indicator content item.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/control-nodes/stddlgprogressitem.md',
    fields: [
      { name: 'text', type: 'string', description: 'Text displayed alongside the spinner.' },
    ],
    methods: [],
  },

  StdDlgDeterminateProgressItem: {
    name: 'StdDlgDeterminateProgressItem',
    extends: 'StdDlgItemBase',
    description: 'A progress bar content item showing a completion percentage.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/control-nodes/stddlgdeterminateprogressitem.md',
    fields: [
      { name: 'percent', type: 'string', description: 'Completion percentage.' },
      { name: 'text', type: 'string', description: 'Text displayed alongside the progress bar.' },
    ],
    methods: [],
  },

  StdDlgGraphicItem: {
    name: 'StdDlgGraphicItem',
    extends: 'StdDlgItemBase',
    description: 'An image content item for a StandardDialog content area.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/control-nodes/stddlggraphicitem.md',
    fields: [],
    methods: [],
  },

  StdDlgCustomItem: {
    name: 'StdDlgCustomItem',
    extends: 'StdDlgItemBase',
    description: 'A custom freeform content item for developer-defined dialog content.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/control-nodes/stddlgcustomitem.md',
    fields: [
      { name: 'widthField', type: 'float', description: 'The available width for custom content.', readonly: true },
      { name: 'fixedWidthField', type: 'float', description: 'Fixed width override for custom content.' },
    ],
    methods: [],
  },

  StdDlgButton: {
    name: 'StdDlgButton',
    extends: 'Group',
    description: 'A button inside a StdDlgButtonArea.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/control-nodes/stddlgbutton.md',
    fields: [
      { name: 'text', type: 'string', description: 'Button label text.' },
      { name: 'disabled', type: 'boolean', description: 'Whether the button is disabled.' },
    ],
    methods: [],
  },

  // ── Font ──────────────────────────────────────────────────────────────────

  Font: {
    name: 'Font',
    extends: 'Node',
    description: 'Specifies a typeface and size for text rendering.',
    docsUrl: 'https://developer.roku.com/docs/references/scenegraph/node-classes/font.md',
    fields: [
      { name: 'uri', type: 'uri', description: 'URI of the font file (TTF/OTF), or "font:SystemFont" / "font:SmallSystemFont".' },
      { name: 'size', type: 'integer', description: 'Font size in points.' },
    ],
    methods: [],
  },
};

export function findSgNode(name: string): SgNodeDefinition | undefined {
  return SG_NODES[name];
}

/** Caches for SG node field/method lookups — catalog is static. */
const _sgFieldsCache = new Map<string, SgNodeField[]>();
const _sgMethodsCache = new Map<string, SgNodeMethod[]>();

export function getAllSgNodeFields(nodeName: string, visited: Set<string> = new Set()): SgNodeField[] {
  if (visited.has(nodeName)) return [];
  const cached = _sgFieldsCache.get(nodeName);
  if (cached && visited.size === 0) return cached;
  visited.add(nodeName);
  const def = SG_NODES[nodeName];
  if (!def) return [];
  const fields = [...def.fields];
  if (def.extends) fields.push(...getAllSgNodeFields(def.extends, visited));
  if (visited.size === 1) _sgFieldsCache.set(nodeName, fields);
  return fields;
}

export function getAllSgNodeMethods(nodeName: string, visited: Set<string> = new Set()): SgNodeMethod[] {
  if (visited.has(nodeName)) return [];
  const cached = _sgMethodsCache.get(nodeName);
  if (cached && visited.size === 0) return cached;
  visited.add(nodeName);
  const def = SG_NODES[nodeName];
  if (!def) return [];
  const methods = [...def.methods];
  if (def.extends) methods.push(...getAllSgNodeMethods(def.extends, visited));
  if (visited.size === 1) _sgMethodsCache.set(nodeName, methods);
  return methods;
}
