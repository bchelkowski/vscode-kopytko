import { expect } from 'chai';
import * as path from 'path';
import * as fs from 'fs';

const SCHEMA_PATH = path.join(__dirname, '../../schemas/kopytkorc.schema.json');

describe('.kopytkorc JSON schema (schemas/kopytkorc.schema.json)', () => {
  let schema: Record<string, unknown>;
  let properties: Record<string, Record<string, unknown>>;

  before(() => {
    const raw = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    schema = JSON.parse(raw) as Record<string, unknown>;
    properties = schema.properties as Record<string, Record<string, unknown>>;
  });

  it('file exists and parses as valid JSON', () => {
    expect(schema).to.be.an('object');
  });

  it('has $schema meta field pointing to JSON Schema draft-07', () => {
    expect(schema.$schema).to.include('json-schema.org');
  });

  it('declares type "object" at root', () => {
    expect(schema.type).to.equal('object');
  });

  it('has a non-empty title and description', () => {
    expect(schema.title).to.be.a('string').and.not.equal('');
    expect(schema.description).to.be.a('string').and.not.equal('');
  });

  it('defines a "sourceDir" property', () => {
    expect(properties).to.have.property('sourceDir');
  });

  it('sourceDir has type "string"', () => {
    expect(properties.sourceDir.type).to.equal('string');
  });

  it('sourceDir has a default value', () => {
    expect(properties.sourceDir).to.have.property('default');
  });

  it('sourceDir has a description', () => {
    expect(properties.sourceDir.description).to.be.a('string').and.not.equal('');
  });

  it('defines a "plugins" property', () => {
    expect(properties).to.have.property('plugins');
  });

  it('plugins has type "array"', () => {
    expect(properties.plugins.type).to.equal('array');
  });

  it('plugins items use $ref to a shared pluginEntry definition', () => {
    const items = properties.plugins.items as Record<string, unknown>;
    expect(items).to.have.property('$ref');
    expect((items.$ref as string)).to.include('pluginEntry');
  });

  it('defines pluginEntry in $defs or definitions supporting string, array, and object forms', () => {
    const defs = (schema.definitions ?? (schema as Record<string, unknown>).$defs) as Record<string, unknown>;
    expect(defs).to.have.property('pluginEntry');
    const entry = defs.pluginEntry as Record<string, unknown>;
    const oneOf = entry.oneOf as Array<Record<string, unknown>>;
    expect(oneOf).to.be.an('array').with.length.at.least(3);
    const types = oneOf.map((o) => o.type as string);
    expect(types).to.include('string');
    expect(types).to.include('array');
    expect(types).to.include('object');
  });

  it('pluginEntry object form has required "name" field', () => {
    const defs = (schema.definitions ?? (schema as Record<string, unknown>).$defs) as Record<string, unknown>;
    const entry = defs.pluginEntry as Record<string, unknown>;
    const oneOf = entry.oneOf as Array<Record<string, unknown>>;
    const objectForm = oneOf.find((o) => o.type === 'object') as Record<string, unknown>;
    expect(objectForm).to.have.property('required');
    expect((objectForm.required as string[])).to.include('name');
  });

  it('pluginEntry object form defines preEnvironmentPlugin as boolean', () => {
    const defs = (schema.definitions ?? (schema as Record<string, unknown>).$defs) as Record<string, unknown>;
    const entry = defs.pluginEntry as Record<string, unknown>;
    const oneOf = entry.oneOf as Array<Record<string, unknown>>;
    const objectForm = oneOf.find((o) => o.type === 'object') as Record<string, unknown>;
    const props = objectForm.properties as Record<string, Record<string, unknown>>;
    expect(props.preEnvironmentPlugin.type).to.equal('boolean');
    expect(props.postGlobalPlugin.type).to.equal('boolean');
  });

  it('defines environments property', () => {
    expect(properties).to.have.property('environments');
    expect(properties.environments.type).to.equal('object');
  });

  it('defines baseManifest property', () => {
    expect(properties).to.have.property('baseManifest');
    expect((properties.baseManifest as Record<string, unknown>).type).to.equal('string');
  });

  it('does not forbid additional properties (open schema)', () => {
    // additionalProperties should be true or absent (not false)
    const ap = schema.additionalProperties;
    expect(ap).to.not.equal(false);
  });

  it('schema file is registered in package.json contributes.jsonValidation', () => {
    const pkgPath = path.join(__dirname, '../../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
    const contributes = pkg.contributes as Record<string, unknown>;
    const validation = contributes.jsonValidation as Array<{ fileMatch: string; url: string }>;
    expect(validation).to.be.an('array');
    const entry = validation.find((v) => v.fileMatch === '**/.kopytkorc');
    expect(entry).to.exist;
    expect(entry!.url).to.include('kopytkorc.schema.json');
  });
});
