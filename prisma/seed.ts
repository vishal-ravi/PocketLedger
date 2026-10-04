import {PrismaClient} from '@prisma/client';
import {buildSchedule, computeEmi} from '../lib/loans';
import {hashPassword} from '../lib/password';
if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SEED !== '1') {
  console.error('Refusing to seed demo data in production (set ALLOW_SEED=1 to override).');
  process.exit(1);
}
const p=new PrismaClient(); const uid='00000000-0000-0000-0000-000000000001';
async function main(){const passwordHash=await hashPassword('demo12345');const u=await p.user.upsert({where:{id:uid},update:{passwordHash},create:{id:uid,email:'demo@example.com',fullName:'Demo User',passwordHash,monthlyIncome:65000}});const names=[['Food',10000,'#f59e0b'],['Transport',5000,'#0ea5e9'],['Rent',18000,'#8b5cf6'],['Bills & Utilities',6000,'#06b6d4'],['Shopping',7000,'#ec4899'],['Health',3000,'#ef4444'],['Subscriptions',2000,'#6366f1']] as const;for(const [name,budget,color] of names)await p.category.upsert({where:{userId_name:{userId:uid,name}},update:{monthlyBudget:budget,colorCode:color},create:{userId:uid,name,monthlyBudget:budget,colorCode:color}});await p.category.updateMany({where:{userId:uid,name:{in:['Rent','Health']}},data:{taxDeductible:true}});const cats=await p.category.findMany({where:{userId:uid}});const food=cats.find(c=>c.name==='Food')!;const transport=cats.find(c=>c.name==='Transport')!;await p.creditCard.upsert({where:{id:'00000000-0000-0000-0000-000000000101'},update:{},create:{id:'00000000-0000-0000-0000-000000000101',userId:uid,cardName:'HDFC Regalia',creditLimit:100000,statementGenerationDay:18,dueDay:8}});if((await p.expense.count({where:{userId:uid}}))===0){await p.expense.createMany({data:[{userId:uid,date:new Date(),categoryId:food.id,description:'Lunch',paymentMethod:'UPI',amount:420,type:'NEED',myShare:420},{userId:uid,date:new Date(),categoryId:transport.id,description:'Cab',paymentMethod:'CREDIT_CARD',creditCardId:'00000000-0000-0000-0000-000000000101',amount:680,type:'NEED',myShare:680}]});}
const demoStart = new Date('2026-06-10');
if (!(await p.loan.findUnique({where: {id: '00000000-0000-0000-0000-000000000102'}}))) {
  const demoEmi = computeEmi(600000, 9.2, 60);
  const loan = await p.loan.create({
    data: {
      id: '00000000-0000-0000-0000-000000000102',
      userId: uid,
      lenderName: 'HDFC car loan',
      principal: 600000,
      annualRate: 9.2,
      tenureMonths: 60,
      emiAmount: demoEmi,
      startDate: demoStart,
      paymentMethod: 'BANK_TRANSFER',
      notes: 'Demo loan seeded with the project',
    },
  });
  await p.loanInstallment.createMany({
    data: buildSchedule(demoStart, 60, demoEmi).map((row) => ({
      loanId: loan.id,
      number: row.number,
      dueDate: row.dueDate,
      amount: row.amount,
    })),
  });
}
if ((await p.splitDetail.count({where: {expense: {userId: uid}}})) === 0) {
  const splitExpense = await p.expense.create({
    data: {
      userId: uid,
      date: new Date('2026-09-28'),
      categoryId: food.id,
      description: 'Dinner split with friends',
      paymentMethod: 'UPI',
      amount: 1800,
      type: 'WANT',
      isSplit: true,
      whoPaid: 'Someone else',
      myShare: 600,
    },
  });
  await p.splitDetail.createMany({
    data: [
      {expenseId: splitExpense.id, personName: 'Rahul', amountIOwe: 600},
      {expenseId: splitExpense.id, personName: 'Anita', amountOwedToMe: 600},
    ],
  });
}
console.log('Seeded',u.email)}main().finally(()=>p.$disconnect());
