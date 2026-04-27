import { z } from 'zod'
import { CUSTOM_ROLE_PERMISSIONS } from './enums.js'

// Auth

export const RegisterSchema = z.object({
  email: z.string().email('Email invÃ¡lido'),
  password: z.string().min(8, 'MÃ­nimo 8 caracteres').max(100),
  fullName: z.string().min(2, 'MÃ­nimo 2 caracteres').max(100),
  lang: z.enum(['es', 'en']).default('es'),
})

export const LoginSchema = z.object({
  email: z.string().email('Email invÃ¡lido'),
  password: z.string().min(1, 'IngresÃ¡ tu contraseÃ±a'),
})

// Organization

export const CreateOrgSchema = z.object({
  name: z.string().min(2).max(80),
})

export const UpdateOrgSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  require2fa: z.boolean().optional(),
  billingCountry: z.enum(['AR', 'US']).nullable().optional(),
})

// Project

export const CreateProjectSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(500).optional(),
})

export const UpdateProjectSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  description: z.string().max(500).optional(),
})

// Environment

export const CreateEnvironmentSchema = z.object({
  name: z.string().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  isProtected: z.boolean().default(false),
})

export const UpdateEnvironmentSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  isProtected: z.boolean().optional(),
})

// CustomRole

const PermissionSchema = z.enum([
  ...CUSTOM_ROLE_PERMISSIONS,
])

export const CreateCustomRoleSchema = z.object({
  name: z.string().min(2).max(60),
  description: z.string().max(300).optional(),
  permissions: z.array(PermissionSchema).min(1),
})

export const UpdateCustomRoleSchema = z.object({
  name: z.string().min(2).max(60).optional(),
  description: z.string().max(300).optional(),
  permissions: z.array(PermissionSchema).min(1).optional(),
})

// Members

const OrgRoleSchema = z.enum(['admin', 'member', 'viewer', 'custom'])

export const InviteMemberSchema = z.object({
  email: z.string().email(),
  role: OrgRoleSchema,
  customRoleId: z.string().uuid().optional(),
}).refine(
  data => data.role !== 'custom' || !!data.customRoleId,
  { message: 'customRoleId es requerido cuando el rol es custom', path: ['customRoleId'] },
)

export const UpdateMemberRoleSchema = z.object({
  role: OrgRoleSchema,
  customRoleId: z.string().uuid().optional(),
}).refine(
  data => data.role !== 'custom' || !!data.customRoleId,
  { message: 'customRoleId es requerido cuando el rol es custom', path: ['customRoleId'] },
)

// Container

export const CreateContainerSchema = z.object({
  name: z.string().min(2).max(80),
  port: z.number().int().min(1).max(65535),
  serverId: z.string().uuid(),
  environmentId: z.string().uuid(),
  healthcheckPath: z.string().optional(),
})

export const UpdateContainerSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  image: z.string().min(1).max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  healthcheckPath: z.string().optional(),
})

// Secrets

export const UpsertSecretSchema = z.object({
  value: z.string().min(1).max(5000),
})

// Domain

export const SetCustomDomainSchema = z.object({
  customDomain: z.string().min(4).max(253),
})

// Add-ons

export const ActivateAddOnSchema = z.object({
  config: z.record(z.unknown()).default({}),
})

export const UpdateAddOnConfigSchema = z.object({
  config: z.record(z.unknown()),
})

// Stack (Docker Compose)

export const CreateStackSchema = z.object({
  name: z.string().min(2).max(80),
  serverId: z.string().uuid(),
  environmentId: z.string().uuid(),
  composeContent: z.string().optional(),
})

export const UpdateStackSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  composeContent: z.string().optional(),
})

// Audit

export const AuditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  action: z.string().optional(),
  actorId: z.string().uuid().optional(),
  resourceType: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

// Pagination

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

// Inferred types

export type RegisterInput = z.infer<typeof RegisterSchema>
export type LoginInput = z.infer<typeof LoginSchema>
export type CreateOrgInput = z.infer<typeof CreateOrgSchema>
export type UpdateOrgInput = z.infer<typeof UpdateOrgSchema>
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>
export type CreateEnvironmentInput = z.infer<typeof CreateEnvironmentSchema>
export type UpdateEnvironmentInput = z.infer<typeof UpdateEnvironmentSchema>
export type CreateCustomRoleInput = z.infer<typeof CreateCustomRoleSchema>
export type UpdateCustomRoleInput = z.infer<typeof UpdateCustomRoleSchema>
export type InviteMemberInput = z.infer<typeof InviteMemberSchema>
export type UpdateMemberRoleInput = z.infer<typeof UpdateMemberRoleSchema>
export type CreateContainerInput = z.infer<typeof CreateContainerSchema>
export type UpdateContainerInput = z.infer<typeof UpdateContainerSchema>
export type UpsertSecretInput = z.infer<typeof UpsertSecretSchema>
export type SetCustomDomainInput = z.infer<typeof SetCustomDomainSchema>
export type ActivateAddOnInput = z.infer<typeof ActivateAddOnSchema>
export type UpdateAddOnConfigInput = z.infer<typeof UpdateAddOnConfigSchema>
export type PaginationInput = z.infer<typeof PaginationSchema>
export type CreateStackInput = z.infer<typeof CreateStackSchema>
export type UpdateStackInput = z.infer<typeof UpdateStackSchema>
export type AuditQueryInput = z.infer<typeof AuditQuerySchema>
