import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AddressesService, type Address } from './addresses.service.js';
import { parseCreateAddress, parseUpdateAddress } from './dto.js';

/**
 * No @Public() anywhere, so the global AuthGuard closes every route, and no
 * @RequireCapability either: capabilities are a SELLER concept (ADR 0013) and
 * an address book belongs to a buyer, who is not a tenant.
 */
@ApiTags('addresses')
@Controller('me/addresses')
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  async list(): Promise<{ items: Address[] }> {
    return { items: await this.addresses.list() };
  }

  @Post()
  async create(@Body() body: unknown): Promise<Address> {
    return this.addresses.create(parseCreateAddress(body));
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<Address> {
    return this.addresses.get(id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown): Promise<Address> {
    return this.addresses.update(id, parseUpdateAddress(body));
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ deleted: true }> {
    await this.addresses.remove(id);
    return { deleted: true };
  }
}
